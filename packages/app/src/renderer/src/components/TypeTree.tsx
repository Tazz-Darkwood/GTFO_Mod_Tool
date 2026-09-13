import { useMemo } from 'react';
import { useStore } from '../store';

const BASELINE_LABEL = { 'wrapper-file': 'file', vanilla: 'vanilla', none: '' } as const;
const BASELINE_TITLE = {
  'wrapper-file': 'A GameData_*_bin.json file replaces the vanilla blocks of this type',
  vanilla: 'The game supplies the vanilla blocks; your PartialData blocks are added on top',
  none: 'No vanilla data known for this type',
} as const;

export function TypeTree() {
  const summary = useStore((s) => s.summary);
  const selectedType = useStore((s) => s.selectedType);
  const showAll = useStore((s) => s.showAllTypes);
  const setShowAll = useStore((s) => s.setShowAllTypes);
  const selectType = useStore((s) => s.selectType);
  const query = useStore((s) => s.blockQuery);
  const setQuery = useStore((s) => s.setBlockQuery);

  const types = useMemo(() => {
    const all = summary?.types ?? [];
    return showAll ? all : all.filter((t) => t.count > 0);
  }, [summary, showAll]);

  if (!summary) return null;
  return (
    <div className="typetree">
      <div className="search">
        <input
          type="search"
          placeholder={
            selectedType ? `Search ${selectedType}…` : 'Search all blocks by ID or name…'
          }
          value={query}
          onChange={(e) => void setQuery(e.target.value)}
        />
        {query && (
          <button className="ghost small" onClick={() => void setQuery('')} title="Clear">
            ×
          </button>
        )}
      </div>
      <div className="typetree-head">
        <span>Types</span>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{' '}
          all
        </label>
      </div>
      <ul className="typelist">
        <li
          className={selectedType === null ? 'selected' : ''}
          onClick={() => void selectType(null)}
        >
          <span className="tname">All project blocks</span>
          <span className="tcount">{summary.blockCount}</span>
        </li>
        {types.map((t) => (
          <li
            key={t.type}
            className={selectedType === t.type ? 'selected' : ''}
            onClick={() => void selectType(t.type)}
            title={`${t.count} in project, ${t.vanillaCount} vanilla. ${BASELINE_TITLE[t.baseline]}`}
          >
            <span className="tname">{t.type}</span>
            {t.problems > 0 && <span className="tproblems">{t.problems}</span>}
            <span className={`tbadge tbadge-${t.baseline}`}>{BASELINE_LABEL[t.baseline]}</span>
            <span className="tcount">{t.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
