/**
 * The Colab notebooks shipped in the repository (notebooks/colab): a downloadable copy bundled
 * with the app, and an "Open in Colab" link to the public repository's main branch.
 */
export const REPOSITORY = 'detinger/sem-lab';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const colabUrl = (stem: string): string =>
  `https://colab.research.google.com/github/${REPOSITORY}/blob/main/notebooks/colab/${stem}.ipynb`;
const urls = import.meta.glob<string>('../../../../../notebooks/colab/*.ipynb', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** example id → notebook file stem */
export const NOTEBOOK_FOR_EXAMPLE: Readonly<Record<string, string>> = {
  'tam-mediation': '01_tam_pls_sem',
  'acsi-inspired': '02_acsi_pls_sem',
  'delone-mclean': '03_delone_mclean_is_success_pls_sem',
  'utaut2-inspired': '04_utaut2_pls_sem',
  'service-quality': '05_service_quality_cb_sem',
};

export interface NotebookLink {
  url: string;
  fileName: string;
  colabUrl: string;
}

export function notebookFor(exampleId: string): NotebookLink | undefined {
  const stem = NOTEBOOK_FOR_EXAMPLE[exampleId];
  if (!stem) return undefined;
  const entry = Object.entries(urls).find(([path]) => path.endsWith(`/${stem}.ipynb`));
  return entry ? { url: entry[1], fileName: `${stem}.ipynb`, colabUrl: colabUrl(stem) } : undefined;
}
