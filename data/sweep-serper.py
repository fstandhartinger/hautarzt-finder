import json, os, time, urllib.request, math

KEY = os.environ["SERPER_API_KEY"]

DE = ["Passau","Vilshofen an der Donau","Pocking","Hauzenberg","Fürstenzell","Bad Griesbach im Rottal",
      "Untergriesbach","Ruhstorf an der Rott","Tittling","Salzweg","Neuhaus am Inn","Bad Füssing",
      "Waldkirchen","Freyung","Grafenau","Röhrnbach","Hutthurm","Ortenburg","Aidenbach",
      "Deggendorf","Plattling","Osterhofen","Hengersberg","Regen","Zwiesel","Viechtach",
      "Pfarrkirchen","Eggenfelden","Simbach am Inn","Bad Birnbach","Arnstorf","Massing",
      "Landau an der Isar","Dingolfing","Straubing","Landshut","Mühldorf am Inn","Altötting","Burghausen"]
AT = ["Schärding","Andorf","Ried im Innkreis","Braunau am Inn","Mattighofen","Rohrbach-Berg","Linz",
      "Freistadt","Grieskirchen","Eferding","Wels","Vöcklabruck","Peuerbach","Neufelden",
      "Aigen-Schlägl","Bad Leonfelden","Altheim","Obernberg am Inn","Taufkirchen an der Pram","Engelhartszell"]

TERMS = ["Hautarzt", "Dermatologe", "Hautarztpraxis"]

def q(query, gl, hl):
    body = json.dumps({"q": query, "gl": gl, "hl": hl}).encode()
    req = urllib.request.Request("https://google.serper.dev/places", data=body,
        headers={"X-API-KEY": KEY, "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r).get("places", [])
        except Exception as e:
            print("  ERR", query, e); time.sleep(2)
    return []

seen = {}
def add(places, country, seed):
    for p in places:
        cid = p.get("cid") or p.get("title","")+p.get("address","")
        if cid in seen:
            seen[cid]["seeds"].add(seed)
            continue
        p["country"] = country
        p["seeds"] = {seed}
        seen[cid] = p

for city in DE:
    for t in TERMS:
        add(q(f"{t} {city}", "de", "de"), "DE", city)
    print("DE", city, len(seen))
for city in AT:
    for t in TERMS:
        add(q(f"{t} {city}", "at", "de"), "AT", city)
    print("AT", city, len(seen))

out = []
for v in seen.values():
    v["seeds"] = sorted(v["seeds"])
    out.append(v)
json.dump(out, open("/tmp/claude-1000/-home-flori-Dev-chutes/2e6e4fc8-0e8d-470d-9ac3-75d5215e9feb/scratchpad/raw_places.json","w"), ensure_ascii=False, indent=1)
print("TOTAL", len(out))
