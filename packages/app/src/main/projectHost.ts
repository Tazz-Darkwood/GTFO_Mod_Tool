/**
 * Owns the single open Project on the main-process side and converts core
 * objects into IPC-safe DTOs. Also watches the folder for outside edits.
 */
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import fuzzysort from 'fuzzysort';
import {
  assertSchemaBundle,
  assertVanillaIndex,
  blockClass,
  buildReferenceIndex,
  createBlockOps,
  createProjectFile,
  deleteBlockOps,
  deleteProjectFile,
  EditSession,
  eligibleTargetFiles,
  findReferences,
  findReferencesToFile,
  isProjectFile,
  lineIndexFor,
  loadProject,
  lookupRef,
  nestedClass,
  NodeFileSystem,
  pluginMentions,
  rangeOf,
  reloadFromDisk,
  saveFile,
  suggestPersistentId,
  buildRundownTree,
  layoutDetailFor,
  findBepInExLog,
  lgtunerFor,
  lgtunerPrefabs,
  lgtunerSkeleton,
  lgtunerFileIdFor,
  createTextFile,
  type LgTunerPrefabs,
  matchLoad,
  parseTileLog,
  tilesForLayout,
  type LgTunerConfig,
  addExpeditionOps,
  duplicateExpeditionOps,
  moveExpeditionOps,
  deleteExpeditionOps,
  addZoneOps,
  duplicateZoneOps,
  deleteZoneOps,
  type LayoutDetail,
  type RundownTree,
  toFileId,
  valueOf,
  validateProject,
  type Block,
  type ClassSchema,
  type Diagnostic,
  type DiagnosticFix,
  type EditOp,
  type EnumSchema,
  type FieldSchema,
  type FileSystem,
  type Project,
  type Reference,
  type ReferenceIndex,
  type SchemaBundle,
  type SourceFile,
  type TypeName,
  type VanillaIndex,
} from '@gtfo/core';
import { loadAllVanillaBlocksFrom, loadSchemaBundleFrom, loadVanillaIndexFrom } from '@gtfo/schema';
import type {
  BlockDetailDto,
  BlockPageDto,
  BlockSummaryDto,
  CreateBlockRequestDto,
  EditFailureDto,
  EditResultDto,
  EditTargetDto,
  FileDto,
  IpcEvents,
  ParseErrorDto,
  ProjectSummaryDto,
  RefCandidateDto,
  ReferenceDto,
  ReferencesDto,
  SaveResultDto,
  SchemaClosureDto,
  TargetFileDto,
  TypeSummaryDto,
  RundownOpDto,
  LayoutGeneratedDto,
} from '@shared/ipc';

type Emit = <K extends keyof IpcEvents>(event: K, payload: IpcEvents[K]) => void;

export interface ProjectHostOptions {
  fs?: FileSystem;
  /** Disable the folder watcher (tests). */
  watch?: boolean;
}

export class ProjectHost {
  private schema!: SchemaBundle;
  private vanilla!: VanillaIndex;
  private project?: Project;
  private session?: EditSession;
  private watcher?: FSWatcher;
  private refIndex?: ReferenceIndex;
  private tree?: RundownTree | null;
  /** absPath -> time we wrote it; used to ignore our own writes in the watcher. */
  private recentWrites = new Map<string, number>();
  private readonly fs: FileSystem;
  private readonly watch: boolean;

  constructor(
    private readonly emit: Emit,
    opts: ProjectHostOptions = {},
  ) {
    this.fs = opts.fs ?? new NodeFileSystem();
    this.watch = opts.watch ?? true;
  }

  async init(schemaDir: string): Promise<void> {
    this.schema = assertSchemaBundle(await loadSchemaBundleFrom(schemaDir));
    const vanilla = assertVanillaIndex(await loadVanillaIndexFrom(schemaDir));
    vanilla.blocks = await loadAllVanillaBlocksFrom(schemaDir, vanilla);
    this.vanilla = vanilla;
  }

  get isOpen(): boolean {
    return !!this.project;
  }

  private need(): { project: Project; session: EditSession } {
    if (!this.project || !this.session) throw new Error('No project is open');
    return { project: this.project, session: this.session };
  }

  private invalidate(): void {
    this.refIndex = undefined;
    this.tree = undefined;
  }

  private refs(): ReferenceIndex {
    if (!this.refIndex) this.refIndex = buildReferenceIndex(this.need().project);
    return this.refIndex;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async open(root: string): Promise<ProjectSummaryDto> {
    await this.close();
    const project = await loadProject(root, this.fs, this.schema, this.vanilla, { sep: path.sep });
    validateProject(project);
    this.project = project;
    this.session = new EditSession(project);
    this.invalidate();
    if (this.watch) this.startWatcher(root);
    return this.summary();
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
    this.project = undefined;
    this.session = undefined;
    this.invalidate();
  }

  async refresh(): Promise<ProjectSummaryDto> {
    const { project } = this.need();
    return this.open(project.rootPath);
  }

  private startWatcher(root: string): void {
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: (p: string) => /\.gtfo-tmp-/.test(p) || /[\\/]node_modules[\\/]/.test(p),
    });
    const onEvent = (kind: 'add' | 'change' | 'unlink') => (absPath: string) => {
      void this.onExternal(kind, absPath).catch((e: Error) =>
        this.emit('project:error', { message: e.message }),
      );
    };
    this.watcher
      .on('change', onEvent('change'))
      .on('add', onEvent('add'))
      .on('unlink', onEvent('unlink'));
  }

  private wroteRecently(absPath: string): boolean {
    const t = this.recentWrites.get(absPath);
    return !!t && Date.now() - t < 2500;
  }

  private async onExternal(kind: 'add' | 'change' | 'unlink', absPath: string): Promise<void> {
    const project = this.project;
    if (!project) return;
    if (this.wroteRecently(absPath)) return;
    const fileId = toFileId(project.rootPath, absPath, path.sep);
    if (!isProjectFile(fileId)) return;
    const file = project.files.get(fileId);
    if (kind === 'add' || kind === 'unlink' || !file) {
      // Structural change: simplest correct thing is to reload the project (dirty files would be lost, so skip if any).
      if ([...project.files.values()].some((f) => f.dirty)) {
        this.emit('project:error', {
          message: `${fileId} was ${kind === 'unlink' ? 'deleted' : 'added'} outside the app. Save or revert your changes, then use Reload.`,
        });
        return;
      }
      await this.open(project.rootPath);
      this.emit('project:changed', this.summary());
      return;
    }
    if (file.dirty) {
      file.externallyModified = true;
      this.emit('file:externalChange', { fileId, wasDirty: true });
      this.emit('project:changed', this.summary());
      return;
    }
    await reloadFromDisk(this.fs, project, fileId);
    this.session?.forget(fileId);
    validateProject(project);
    this.invalidate();
    this.emit('file:externalChange', { fileId, wasDirty: false });
    this.emit('project:changed', this.summary());
  }

  // ---------------------------------------------------------------------------
  // Read side
  // ---------------------------------------------------------------------------

  private problemsByBlock(project: Project): Map<string, number> {
    const m = new Map<string, number>();
    for (const d of project.diagnostics)
      if (d.blockId) m.set(d.blockId, (m.get(d.blockId) ?? 0) + 1);
    return m;
  }
  private problemsByFile(project: Project): Map<string, number> {
    const m = new Map<string, number>();
    for (const d of project.diagnostics) m.set(d.file, (m.get(d.file) ?? 0) + 1);
    return m;
  }

  summary(): ProjectSummaryDto {
    const { project } = this.need();
    const shapes: Record<string, number> = {};
    for (const f of project.files.values()) shapes[f.shape] = (shapes[f.shape] ?? 0) + 1;
    const problemsByType = new Map<string, number>();
    for (const d of project.diagnostics) {
      const b = d.blockId ? project.index.byId.get(d.blockId) : undefined;
      if (b?.type) problemsByType.set(b.type, (problemsByType.get(b.type) ?? 0) + 1);
    }
    const typeNames = new Set<string>([
      ...Object.keys(this.schema.blockTypes),
      ...project.index.byType.keys(),
    ]);
    const types: TypeSummaryDto[] = [...typeNames].sort().map((type) => {
      const res = project.resolutions.get(type);
      const ids = project.index.byType.get(type);
      let count = 0;
      if (ids) for (const list of ids.values()) count += list.length;
      return {
        type,
        count,
        baseline: res?.baseline ?? 'none',
        wrapperFile: res?.wrapperFile,
        problems: problemsByType.get(type) ?? 0,
        vanillaCount: Object.keys(this.vanilla.types[type] ?? {}).length,
        hasFullVanilla: !!this.vanilla.blocks?.[type],
      };
    });
    const counts = { error: 0, warning: 0, info: 0 };
    for (const d of project.diagnostics) counts[d.severity]++;
    return {
      root: project.rootPath,
      fileCount: project.files.size,
      blockCount: project.index.byId.size,
      shapes,
      types,
      diagnostics: counts,
      dirtyFiles: [...project.files.values()].filter((f) => f.dirty).map((f) => f.id),
      externallyModified: [...project.files.values()]
        .filter((f) => f.externallyModified)
        .map((f) => f.id),
      schemaCommit: this.schema.meta.commit.slice(0, 7),
    };
  }

  listFiles(): FileDto[] {
    const { project } = this.need();
    const problems = this.problemsByFile(project);
    return [...project.files.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((f) => this.fileDto(f, problems));
  }

  private fileDto(f: SourceFile, problems?: Map<string, number>): FileDto {
    const { project } = this.need();
    const blocks = project.index.byFile.get(f.id) ?? [];
    const types = [...new Set(blocks.map((b) => b.type).filter((t): t is string => !!t))].sort();
    return {
      id: f.id,
      shape: f.shape,
      wrapperType: f.wrapperType,
      dirty: f.dirty,
      externallyModified: f.externallyModified,
      parseErrors: f.parseErrors.length,
      blockCount: blocks.length,
      problems: (problems ?? this.problemsByFile(project)).get(f.id) ?? 0,
      types,
      canHoldBlocks:
        (f.shape === 'wrapper' || f.shape === 'partial-array') &&
        !!f.tree &&
        f.parseErrors.length === 0,
      size: f.text.length,
    };
  }

  fileText(fileId: string): string {
    const { project } = this.need();
    const f = project.files.get(fileId);
    if (!f) throw new Error(`Unknown file ${fileId}`);
    return f.text;
  }

  private blockSummary(b: Block, problems: Map<string, number>): BlockSummaryDto {
    const file = this.need().project.files.get(b.file)!;
    const line = lineIndexFor(file, file.text).position(b.node.offset).line;
    return {
      blockId: b.id,
      type: b.type,
      persistentID: b.persistentID,
      name: b.name,
      file: b.file,
      line,
      problems: problems.get(b.id) ?? 0,
      plugin: b.plugin,
    };
  }

  listBlocks(q: {
    type?: TypeName;
    query?: string;
    limit?: number;
    offset?: number;
  }): BlockPageDto {
    const { project } = this.need();
    const problems = this.problemsByBlock(project);
    let blocks: Block[];
    if (q.type) {
      blocks = [];
      const ids = project.index.byType.get(q.type);
      if (ids) for (const list of ids.values()) blocks.push(...list);
      blocks.push(...project.index.untyped.filter((b) => b.type === q.type));
      blocks.sort(
        (a, b) =>
          (a.persistentID ?? Infinity) - (b.persistentID ?? Infinity) ||
          a.file.localeCompare(b.file),
      );
    } else {
      blocks = [...project.index.byId.values()];
    }
    if (q.query && q.query.trim()) {
      const targets = blocks.map((b) => ({
        b,
        s: `${b.persistentID ?? ''} ${b.name ?? ''} ${b.type ?? ''} ${b.file}`,
      }));
      const res = fuzzysort.go(q.query.trim(), targets, {
        key: 's',
        limit: 500,
        threshold: -10000,
      });
      blocks = res.map((r) => r.obj.b);
    }
    const total = blocks.length;
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 500;
    return {
      items: blocks.slice(offset, offset + limit).map((b) => this.blockSummary(b, problems)),
      total,
    };
  }

  locateBlock(q: { file: string; type?: TypeName; persistentID: number }): BlockSummaryDto | null {
    const { project, session } = this.need();
    const b = session.locateBlock(q.file, q.type, q.persistentID);
    return b ? this.blockSummary(b, this.problemsByBlock(project)) : null;
  }

  blockDetail(blockId: string): BlockDetailDto | null {
    const { project } = this.need();
    const b = project.index.byId.get(blockId);
    if (!b) return null;
    const file = project.files.get(b.file)!;
    const tokenStyles: BlockDetailDto['tokenStyles'] = {};
    const tokenRanges: BlockDetailDto['tokenRanges'] = {};
    const walk = (node: typeof b.node, pointer: string) => {
      switch (node.type) {
        case 'object':
          tokenRanges[pointer] = { offset: node.offset, length: node.length };
          for (const prop of node.children ?? []) {
            const k = prop.children?.[0];
            const v = prop.children?.[1];
            if (k && v)
              walk(v, `${pointer}/${String(k.value).replace(/~/g, '~0').replace(/\//g, '~1')}`);
          }
          return;
        case 'array':
          tokenRanges[pointer] = { offset: node.offset, length: node.length };
          (node.children ?? []).forEach((c, i) => walk(c, `${pointer}/${i}`));
          return;
        case 'string':
          tokenStyles[pointer] = 'string';
          return;
        case 'number': {
          const raw = file.text.slice(node.offset, node.offset + node.length);
          tokenStyles[pointer] = /[.eE]/.test(raw) ? 'float' : 'int';
          return;
        }
        case 'boolean':
          tokenStyles[pointer] = 'bool';
          return;
        case 'null':
          tokenStyles[pointer] = 'null';
          return;
        default:
          return;
      }
    };
    walk(b.node, '');
    return {
      ...this.blockSummary(b, this.problemsByBlock(project)),
      path: b.path,
      range: rangeOf(b.node, lineIndexFor(file, file.text)),
      value: valueOf(b.node),
      tokenStyles,
      tokenRanges,
      dirty: file.dirty,
      fileShape: file.shape,
    };
  }

  diagnostics(fileId?: string): Diagnostic[] {
    const { project } = this.need();
    return fileId ? project.diagnostics.filter((d) => d.file === fileId) : project.diagnostics;
  }

  searchRefs(q: {
    refType: TypeName;
    query: string;
    limit?: number;
    source?: 'project' | 'vanilla';
  }): RefCandidateDto[] {
    const { project } = this.need();
    const out: RefCandidateDto[] = [];
    if (q.source !== 'vanilla') {
      const ids = project.index.byType.get(q.refType);
      if (ids)
        for (const [id, list] of ids)
          out.push({ id, name: list[0]!.name ?? '', source: 'project', blockId: list[0]!.id });
    }
    const res = project.resolutions.get(q.refType);
    if (q.source !== 'project' && (q.source === 'vanilla' || !res || res.baseline === 'vanilla')) {
      const seen = new Set(out.map((o) => o.id));
      for (const [idStr, name] of Object.entries(this.vanilla.types[q.refType] ?? {})) {
        const id = Number(idStr);
        if (!seen.has(id)) out.push({ id, name, source: 'vanilla' });
      }
    }
    const query = q.query.trim();
    const limit = q.limit ?? 50;
    if (!query) return out.sort((a, b) => a.id - b.id).slice(0, limit);
    const targets = out.map((o) => ({ o, s: `${o.id} ${o.name}` }));
    return fuzzysort.go(query, targets, { key: 's', limit, threshold: -10000 }).map((r) => r.obj.o);
  }

  resolveRef(q: { refType: TypeName; id: number }): RefCandidateDto | null {
    const { project } = this.need();
    const r = lookupRef(project, q.refType, q.id);
    return r ? { id: q.id, name: r.name, source: r.source, blockId: r.block?.id } : null;
  }

  private refDto(r: Reference): ReferenceDto {
    return {
      blockId: r.blockId,
      file: r.file,
      type: r.type,
      persistentID: r.persistentID,
      name: r.name,
      field: r.field,
      path: r.path,
      range: r.range,
      via: r.via,
    };
  }

  references(q: { type: TypeName; id: number }): ReferencesDto {
    const { project } = this.need();
    return {
      refs: findReferences(project, q.type, q.id, this.refs()).map((r) => this.refDto(r)),
      mentions: pluginMentions(project, q.id),
    };
  }

  fileReferences(fileId: string): ReferenceDto[] {
    const { project } = this.need();
    return findReferencesToFile(project, fileId, this.refs()).map((r) => this.refDto(r));
  }

  nextId(type: TypeName, targetFile?: string): { id: number; basis: string } {
    return suggestPersistentId(this.need().project, type, targetFile);
  }

  targetFiles(type: TypeName): TargetFileDto[] {
    return eligibleTargetFiles(this.need().project, type);
  }

  schemaType(type: TypeName) {
    return blockClass(this.schema, type) ?? null;
  }
  schemaClass(name: string) {
    return nestedClass(this.schema, name) ?? null;
  }
  schemaEnum(name: string) {
    return this.schema.enums[name] ?? null;
  }
  schemaTypes(): TypeName[] {
    return Object.keys(this.schema.blockTypes).sort();
  }

  schemaClosure(type: TypeName): SchemaClosureDto | null {
    const root = blockClass(this.schema, type);
    if (!root) return null;
    const classes: Record<string, ClassSchema> = {};
    const enums: Record<string, EnumSchema> = {};
    const visitClass = (cls: ClassSchema) => {
      for (const f of cls.fields) visitField(f);
    };
    const visitField = (f: FieldSchema) => {
      switch (f.kind) {
        case 'list':
          visitField(f.item);
          return;
        case 'enum':
          if (!enums[f.enumName] && this.schema.enums[f.enumName])
            enums[f.enumName] = this.schema.enums[f.enumName]!;
          return;
        case 'object': {
          if (classes[f.className]) return;
          const c = nestedClass(this.schema, f.className);
          if (!c) return;
          classes[f.className] = c;
          visitClass(c);
          return;
        }
        default:
          return;
      }
    };
    visitClass(root);
    return { root, classes, enums };
  }

  // ---------------------------------------------------------------------------
  // Write side
  // ---------------------------------------------------------------------------

  private editResult(fileId: string, blockId?: string): EditResultDto {
    const { project } = this.need();
    this.invalidate();
    const file = project.files.get(fileId)!;
    const summary = this.summary();
    this.emit('project:changed', summary);
    return {
      ok: true,
      file: this.fileDto(file),
      block: blockId ? (this.blockDetail(blockId) ?? undefined) : undefined,
      summary,
    };
  }

  private failure(e: unknown): EditFailureDto {
    const err = e as Error & { parseErrors?: { offset: number; length: number; error: number }[] };
    const out: EditFailureDto = { ok: false, error: err.message };
    if (err.parseErrors && this.project) {
      out.parseErrors = err.parseErrors.map((p) => ({
        offset: p.offset,
        length: p.length,
        line: 0,
        col: 0,
        message: `JSON error code ${p.error}`,
      })) as ParseErrorDto[];
    }
    return out;
  }

  applyEdit(target: EditTargetDto, op: EditOp): EditResultDto | EditFailureDto {
    try {
      const { session } = this.need();
      session.apply({ file: target.file, blockId: target.blockId }, op);
      return this.editResult(target.file, target.blockId);
    } catch (e) {
      return this.failure(e);
    }
  }

  /** Navigator data, cached until the next edit/reload. Null when the project defines no Rundown block. */
  rundownTree(): RundownTree | null {
    if (this.tree === undefined) {
      const t = buildRundownTree(this.need().project);
      this.tree = t.rundowns.length ? t : null;
    }
    return this.tree;
  }

  layoutDetail(layoutBlockId: string): LayoutDetail | null {
    return layoutDetailFor(this.need().project, layoutBlockId);
  }

  lgtunerPrefabs(): LgTunerPrefabs {
    return lgtunerPrefabs(this.need().project);
  }

  async lgtunerCreate(
    layoutBlockId: string,
  ): Promise<{ ok: true; file: FileDto; summary: ProjectSummaryDto } | EditFailureDto> {
    try {
      const { project } = this.need();
      const block = project.index.byId.get(layoutBlockId);
      if (!block || block.type !== 'LevelLayout' || block.persistentID === undefined)
        throw new Error('Not a LevelLayout block');
      const fileId = lgtunerFileIdFor(project, layoutBlockId);
      const abs = path.join(project.rootPath, ...fileId.split('/'));
      this.recentWrites.set(abs, Date.now());
      const file = await createTextFile(
        this.fs,
        project,
        fileId,
        lgtunerSkeleton(block.persistentID),
        { sep: path.sep },
      );
      validateProject(project);
      this.invalidate();
      const summary = this.summary();
      this.emit('project:changed', summary);
      return { ok: true, file: this.fileDto(file), summary };
    } catch (e) {
      return this.failure(e);
    }
  }

  lgtunerConfig(layoutBlockId: string): LgTunerConfig | null {
    return lgtunerFor(this.need().project, layoutBlockId)[0] ?? null;
  }

  /** Latest level load in the BepInEx log whose expedition uses this layout. */
  async layoutGenerated(layoutBlockId: string): Promise<LayoutGeneratedDto | null> {
    const { project } = this.need();
    const tree = this.rundownTree();
    if (!tree) return null;
    const logPath = await findBepInExLog(this.fs, project.rootPath, path.sep);
    if (!logPath) return null;
    const [st, text] = await Promise.all([this.fs.stat(logPath), this.fs.readFile(logPath)]);
    const loads = parseTileLog(text);
    for (let i = loads.length - 1; i >= 0; i--) {
      const load = loads[i]!;
      const best = matchLoad(project, tree, load)[0];
      if (!best) continue;
      const exp = tree.rundowns
        .find((r) => r.id === best.rundownId)
        ?.tiers.find((t) => t.tier === best.tier)
        ?.expeditions.find((e) => e.index === best.index);
      if (!exp) continue;
      const uses =
        exp.layers.some((l) => l.layout?.blockId === layoutBlockId) ||
        exp.dimensions.some((d) => d.layout?.blockId === layoutBlockId);
      if (!uses) continue;
      return {
        tiles: tilesForLayout(project, exp, load, layoutBlockId),
        source: {
          file: logPath,
          mtimeMs: st?.mtimeMs ?? 0,
          loadIndex: i,
          loadCount: loads.length,
          lineStart: load.lineStart,
          expedition: best,
          ...(load.expeditionHint ? { hint: load.expeditionHint } : {}),
        },
      };
    }
    return null;
  }

  rundownOp(op: RundownOpDto): EditResultDto | EditFailureDto {
    try {
      const { project, session } = this.need();
      const plan =
        op.kind === 'addExpedition'
          ? addExpeditionOps(project, op.rundownBlockId, op.tier, {
              prefix: op.prefix,
              publicName: op.publicName,
            })
          : op.kind === 'duplicateExpedition'
            ? duplicateExpeditionOps(project, op.rundownBlockId, op.tier, op.index)
            : op.kind === 'moveExpedition'
              ? moveExpeditionOps(project, op.rundownBlockId, op.from, op.index, op.to)
              : op.kind === 'deleteExpedition'
                ? deleteExpeditionOps(project, op.rundownBlockId, op.tier, op.index)
                : op.kind === 'addZone'
                  ? addZoneOps(project, op.layoutBlockId, {
                      buildFrom: op.buildFrom,
                      direction: op.direction,
                    })
                  : op.kind === 'duplicateZone'
                    ? duplicateZoneOps(project, op.layoutBlockId, op.index)
                    : deleteZoneOps(project, op.layoutBlockId, op.index);
      session.applyMany(plan.target, plan.ops);
      return this.editResult(plan.target.file, plan.target.blockId);
    } catch (e) {
      return this.failure(e);
    }
  }

  applyMany(target: EditTargetDto, ops: EditOp[]): EditResultDto | EditFailureDto {
    try {
      const { session } = this.need();
      session.applyMany({ file: target.file, blockId: target.blockId }, ops);
      return this.editResult(target.file, target.blockId);
    } catch (e) {
      return this.failure(e);
    }
  }

  applyFix(fix: DiagnosticFix): EditResultDto | EditFailureDto {
    try {
      const { session } = this.need();
      const results = session.applyFix(fix);
      const last = results[results.length - 1];
      const first = fix.edits[0];
      return this.editResult(last?.file.id ?? first!.file, first?.blockId);
    } catch (e) {
      return this.failure(e);
    }
  }

  setFileText(
    fileId: string,
    text: string,
    opts: { undoGroup?: string } = {},
  ): EditResultDto | EditFailureDto {
    try {
      const { session } = this.need();
      session.replaceText(fileId, text, opts);
      return this.editResult(fileId);
    } catch (e) {
      return this.failure(e);
    }
  }

  createBlock(req: CreateBlockRequestDto): (EditResultDto & { blockId: string }) | EditFailureDto {
    try {
      const { project, session } = this.need();
      const plan = createBlockOps(project, req);
      session.applyMany(plan.target, plan.ops);
      const created = session.locateBlock(req.targetFile, req.type, req.persistentID);
      if (!created) throw new Error('Block was inserted but could not be located');
      return { ...this.editResult(req.targetFile, created.id), blockId: created.id };
    } catch (e) {
      return this.failure(e);
    }
  }

  deleteBlock(blockId: string): EditResultDto | EditFailureDto {
    try {
      const { project, session } = this.need();
      const plan = deleteBlockOps(project, blockId);
      session.applyMany(plan.target, plan.ops);
      return this.editResult(plan.target.file);
    } catch (e) {
      return this.failure(e);
    }
  }

  undo(fileId: string): EditResultDto | EditFailureDto | null {
    const { session } = this.need();
    const r = session.undoFile(fileId);
    return r ? this.editResult(fileId) : null;
  }
  redo(fileId: string): EditResultDto | EditFailureDto | null {
    const { session } = this.need();
    const r = session.redoFile(fileId);
    return r ? this.editResult(fileId) : null;
  }

  async save(fileId: string, force = false): Promise<SaveResultDto> {
    const { project } = this.need();
    const file = project.files.get(fileId);
    if (!file) return { ok: false, reason: 'missing' };
    try {
      this.recentWrites.set(file.absPath, Date.now());
      const r = await saveFile(this.fs, project, fileId, { force });
      if (!r.ok) return { ok: false, reason: r.reason };
      this.emit('project:changed', this.summary());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
  }

  async saveAll(): Promise<{ saved: string[]; conflicts: string[] }> {
    const { project } = this.need();
    const saved: string[] = [];
    const conflicts: string[] = [];
    for (const f of [...project.files.values()].filter((x) => x.dirty)) {
      const r = await this.save(f.id);
      (r.ok ? saved : conflicts).push(f.id);
    }
    return { saved, conflicts };
  }

  async revert(fileId: string): Promise<void> {
    const { project, session } = this.need();
    await reloadFromDisk(this.fs, project, fileId);
    session.forget(fileId);
    validateProject(project);
    this.invalidate();
    this.emit('project:changed', this.summary());
  }

  async createFile(req: {
    path: string;
    kind: 'partial-array' | 'wrapper';
  }): Promise<{ ok: true; file: FileDto; summary: ProjectSummaryDto } | EditFailureDto> {
    try {
      const { project } = this.need();
      const fileId = req.path.replace(/\\/g, '/').replace(/^\/+/, '');
      const abs = path.join(project.rootPath, ...fileId.split('/'));
      this.recentWrites.set(abs, Date.now());
      // Match the indentation most of the project uses.
      const styles = [...project.files.values()].map((f) => f.style.indentUnit).filter(Boolean);
      const unit = mode(styles as string[]) ?? '  ';
      const file = await createProjectFile(this.fs, project, fileId, req.kind, {
        sep: path.sep,
        style: { eol: '\n', bom: false, indentUnit: unit },
      });
      validateProject(project);
      this.invalidate();
      const summary = this.summary();
      this.emit('project:changed', summary);
      return { ok: true, file: this.fileDto(file), summary };
    } catch (e) {
      return this.failure(e);
    }
  }

  async deleteFile(
    fileId: string,
  ): Promise<{ ok: true; summary: ProjectSummaryDto } | EditFailureDto> {
    try {
      const { project, session } = this.need();
      const f = project.files.get(fileId);
      if (!f) throw new Error(`Unknown file ${fileId}`);
      this.recentWrites.set(f.absPath, Date.now());
      await deleteProjectFile(this.fs, project, fileId);
      session.forget(fileId);
      validateProject(project);
      this.invalidate();
      const summary = this.summary();
      this.emit('project:changed', summary);
      return { ok: true, summary };
    } catch (e) {
      return this.failure(e);
    }
  }

  absPath(fileId: string): string | undefined {
    return this.project?.files.get(fileId)?.absPath;
  }
}

function mode(xs: string[]): string | undefined {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [k, v] of c)
    if (v > n) {
      best = k;
      n = v;
    }
  return best;
}
