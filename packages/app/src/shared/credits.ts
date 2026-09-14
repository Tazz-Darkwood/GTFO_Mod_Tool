/** Third-party work the tool builds on; shown in the UI wherever it is used. */
export const CREDITS = {
  lgtuner: {
    name: 'LGTuner',
    by: 'hirnukuono, based on Flowaria’s LGTuner',
    what: 'tile override format and the per-tile log line the Tiles view reads',
    url: 'https://thunderstore.io/c/gtfo/p/hirnukuono/LGTuner/',
  },
  originalDataBlocks: {
    name: 'OriginalDataBlocks',
    by: 'UntiIted and contributors',
    what: 'datablock schema (TypeList) and vanilla data',
    url: 'https://github.com/UntiIted/OriginalDataBlocks',
  },
  mtfo: {
    name: 'MTFO and MTFO.Ext.PartialData',
    by: 'dakkhuza, Flowaria and the GTFO modding community',
    what: 'the datablock and PartialData file formats',
    url: 'https://thunderstore.io/c/gtfo/p/dakkhuza/MTFO/',
  },
} as const;

export const LGTUNER_CREDIT_LINE = `Tile data and override format: ${CREDITS.lgtuner.name} by ${CREDITS.lgtuner.by}.`;
