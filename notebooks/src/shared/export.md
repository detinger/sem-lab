%% markdown
## Export: CSV, figures and Word-ready tables

The next cell writes everything to the folder `exports/` and zips it:

- `data.csv` (the synthetic data), `model.json`, `analysis.json` and `result.json` (the full
  result in SEM Lab's result format, the same JSON the app produces);
- one CSV per results table (unrounded numbers);
- every figure as PNG (200 dpi);
- `tables_word.html`: the main tables as APA-style tables with inline styles. Open the file
  in a browser, select a table, copy and paste it into Word or Google Docs: it arrives as an
  editable table. The same tables are shown below the cell, so you can also copy them
  straight from the notebook output.

On Colab, the zip file downloads automatically (allow pop-ups if your browser asks). Outside
Colab, find it in the notebook's working directory.

%% code
import os
import shutil

from IPython.display import HTML

EXPORT_DIR = "exports"
shutil.rmtree(EXPORT_DIR, ignore_errors=True)
ensure_dir(EXPORT_DIR)
shutil.copy("data.csv", EXPORT_DIR)
shutil.copy("model.json", EXPORT_DIR)
write_json(os.path.join(EXPORT_DIR, "analysis.json"), analysis)
write_json(os.path.join(EXPORT_DIR, "result.json"), result)
for name, table in EXPORT_TABLES.items():
    table.to_csv(os.path.join(EXPORT_DIR, name), index=not isinstance(table.index, pd.RangeIndex))
for name, fig in FIGURES.items():
    save_figure(fig, EXPORT_DIR, name)
save_word_tables(os.path.join(EXPORT_DIR, "tables_word.html"), WORD_TABLES, "{{NOTEBOOK}}: tables")
zip_path = zip_folder(EXPORT_DIR, "{{NOTEBOOK}}_exports.zip")
print("\n".join(sorted(os.listdir(EXPORT_DIR))))
print(f"\n{zip_path}: {os.path.getsize(zip_path) // 1024} KiB")
offer_download(zip_path)
HTML("".join(word_table_html(df_, title, note, decimals) + "<br>" for title, df_, note, decimals in WORD_TABLES))
