%% markdown
## 3. Indicators: mapping, dictionary and descriptives

The model below is SEM Lab's canonical model file for this example
(`packages/fixtures/synthetic/{{CASE_ID}}/model.json`), embedded unchanged. Each indicator
is bound to a CSV column and declares its scale endpoints, which IPMA needs to rescale
scores to 0–100.

%% code
import json

MODEL_JSON = r'''
{{MODEL_JSON}}
'''
model = json.loads(MODEL_JSON)
assert hashlib.sha256((MODEL_JSON.strip("\n") + "\n").encode("utf-8")).hexdigest() == "{{MODEL_SHA256}}"
with open("model.json", "w", encoding="utf-8") as f:
    f.write(MODEL_JSON.strip("\n") + "\n")

dictionary = data_dictionary(model, profiles)
dictionary

%% code
desc = descriptives(df, model)
show(desc, 2)

%% code
FIGURES = {}  # every figure is collected here for the export section
FIGURES["item_distributions.png"] = likert_distribution_plot(df, model)
plt.show()
