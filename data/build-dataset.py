import json, re, math, os, urllib.request, urllib.parse, time

HOME = (48.562705, 13.420486)
MAX_KM = 100.0
TOKEN = os.environ["MAPBOX_PUBLIC_ACCESS_TOKEN"]

def hav(a, b):
    R = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def geocode(q, country):
    url = ("https://api.mapbox.com/geocoding/v5/mapbox.places/"
           + urllib.parse.quote(q) + ".json?limit=1&country=" + country
           + "&access_token=" + TOKEN)
    with urllib.request.urlopen(url, timeout=30) as r:
        f = json.load(r)["features"]
    return (f[0]["center"][1], f[0]["center"][0]) if f else None

raw = json.load(open("raw_places.json"))

def is_derm(p):
    cat = p.get("category") or ""
    t = (p.get("title","") + " " + (p.get("website") or ""))
    return cat in ("Hautarzt", "Dermatologe") or bool(re.search(r"haut|derma|venerolog", t, re.I))

def norm_addr(a):
    a = (a or "").lower()
    a = re.sub(r"www\.[a-z]+,?\s*", "", a)
    a = re.sub(r"[/,].*?(stock|obergescho|top|haus)\S*", " ", a)
    a = re.sub(r"str(aße|asse|\.)", "str", a)
    a = re.sub(r"pl(atz|\.)", "pl", a)
    a = re.sub(r"[^a-z0-9äöüß]+", "", a)
    return a

cands = []
for p in raw:
    if not is_derm(p) or not p.get("latitude"):
        continue
    km = hav(HOME, (p["latitude"], p["longitude"]))
    if km > MAX_KM:
        continue
    p["km"] = km
    cands.append(p)

# merge entries sharing the same normalised address
groups = {}
for p in cands:
    groups.setdefault(norm_addr(p.get("address")), []).append(p)

def clean_addr(a):
    a = re.sub(r"^www\.[^,]*,\s*", "", a or "")
    a = re.sub(r"^[^,]*?,\s*(?=\w+(str|gasse|platz|pl\.))", "", a, flags=re.I)
    a = re.sub(r"/\d+\.?\s*(Stock|Obergescho\w+)", "", a, flags=re.I)
    a = re.sub(r"-(Am Wald|Oberperlasberg|Galgenberg|Bruckhäuser|Therme|Obersimbach|Kamm|Seiteneingang|Hacklberg|Rittsteig|Vahrenwald.*|Kirchrode.*|Piflas|Kalk)$", "", a)
    return a.strip()

docs = []
for key, g in groups.items():
    g.sort(key=lambda x: -(x.get("ratingCount") or 0))
    main = g[0]
    others = [x["title"] for x in g[1:]]
    docs.append({
        "name": main["title"].strip(),
        "also": others,
        "address": clean_addr(main.get("address")),
        "lat": main["latitude"], "lon": main["longitude"],
        "phone": main.get("phoneNumber"),
        "website": main.get("website"),
        "rating": main.get("rating"),
        "rating_count": main.get("ratingCount"),
        "cid": main.get("cid"),
        "km": main["km"],
        "source": "Google Maps",
    })

MANUAL = [
  dict(name="Dres. Gerhard & Antoinette Gassenmaier – Fachärzte für Dermatologie",
       address="Bahnhofstraße 24, 94032 Passau", country="de", phone="0851 71088",
       website=None, rating=None, rating_count=None,
       note="Status unklar: einige Verzeichnisse führen die Praxis als geschlossen, andere als aktiv (Stand 08/2025). Kein Google-Maps-Eintrag mehr. Unbedingt zuerst anrufen."),
  dict(name="Dr. med. Marion-Michèle Lemmé – Hautärztin (Europa Therme)",
       address="Kurallee 23, 94072 Bad Füssing", country="de", phone="08531 1350073",
       website=None, rating=None, rating_count=None,
       note="Hautarztpraxis in der Europa Therme Bad Füssing. E-Mail: hautarztpraxisdrlemme@t-online.de"),
  dict(name="Dr. med. Patricia Kühnl – Fachärztin für Haut- und Geschlechtskrankheiten",
       address="Maximilianstraße 7b, 84359 Simbach am Inn", country="de", phone="08571 7779",
       website="http://www.doktor-kuehnl.de", rating=None, rating_count=None,
       note="Auch Allergologie. Sprechzeiten Mo–Do 9–13 / 14:30–17:30, Fr 9–13."),
  dict(name="Dr. Helge Degreif & Dr. Behnaz Degreif-Fazeli – Dermatologisch-chirurgische Gemeinschaftsordination",
       address="Marktplatz 3, 4910 Ried im Innkreis, Österreich", country="at", phone="+43 7752 81699",
       website="https://www.degreif.at/", rating=4.2, rating_count=31,
       note="Ordination Mo–Do 9–13, Mi 9–16, Fr nach Vereinbarung. E-Mail: ordination@degreif.at"),
  dict(name="Dr. Rudolf Ostermaier – Facharzt für Dermatologie",
       address="Silberzeile 10, 4780 Schärding, Österreich", country="at", phone="+43 7712 29553",
       website=None, rating=None, rating_count=None,
       note="Gemeinsam mit Dr. Wiesinger als 'Dr. Ostermaier & Dr. Wiesinger OG'. Ordination Mo 8:30–11:30, Di/Mi 14–17, Do 8:30–11:30. Gleiche Telefonnummer wie Dr. Wiesinger."),
]

for m in MANUAL:
    c = geocode(m["address"].replace(", Österreich",""), m["country"])
    if not c:
        print("GEOCODE FAIL", m["address"]); continue
    docs.append({
        "name": m["name"], "also": [], "address": m["address"],
        "lat": c[0], "lon": c[1], "phone": m["phone"], "website": m["website"],
        "rating": m["rating"], "rating_count": m["rating_count"], "cid": None,
        "km": hav(HOME, c), "source": "Web-Recherche", "note": m["note"],
    })
    time.sleep(0.2)

PRIVATE_HINTS = re.compile(r"privat|wahlarzt|wahlärzt", re.I)
KASSE_OVERRIDE = {}
PRIVAT_OVERRIDE = {"Dr. med Martina Auth", "Hautarzt Privat-Praxis Dr. med. Claus Gruss",
                   "Privatärztliche Praxis für Hauterkrankungen",
                   "Hautarztpraxis Sonja Albert, Privatpraxis"}

for d in docs:
    d["km"] = round(d["km"], 1)
    d["country"] = "AT" if re.search(r"\b[45]\d{3}\b", d["address"]) and "Österreich" in d["address"] + str(d.get("note","")) or re.search(r",\s*(4\d{3}|5\d{3})\s", " "+d["address"]+" ") else "DE"
    d["billing"] = "Privat/Wahlarzt" if (PRIVATE_HINTS.search(d["name"]) or d["name"] in PRIVAT_OVERRIDE) else "unbekannt"
    d.setdefault("note", None)
    # city
    m = re.search(r"(\d{4,5})\s+([^,]+)", d["address"])
    d["zip"] = m.group(1) if m else ""
    d["city"] = m.group(2).strip() if m else ""

# country from zip length: DE 5-digit, AT 4-digit
for d in docs:
    d["country"] = "AT" if len(d["zip"]) == 4 else "DE"

FIXUPS = {
 "Dr. med. Martin Barsch, MBA - Hautarzt + Hautchirurg (Wahlarzt) - Zentrum für Lipödem Österreich":
   {"address": "Starhembergstraße 12, 4020 Linz, Österreich"},
 "Hautarzt Dingolfing Dr. Huber": {"phone": None},
}
for d in docs:
    f = FIXUPS.get(d["name"])
    if f: d.update(f)
    if d.get("phone") in ("000000000", "0000000000"): d["phone"] = None
    m = re.search(r"(\d{4,5})\s+([^,]+)", d["address"])
    d["zip"] = m.group(1) if m else d["zip"]
    d["city"] = m.group(2).strip() if m else d["city"]
    d["country"] = "AT" if len(d["zip"]) == 4 else "DE"

docs.sort(key=lambda x: x["km"])
json.dump(docs, open("doctors.json","w"), ensure_ascii=False, indent=1)
print("TOTAL", len(docs))
for d in docs:
    print(f"{d['km']:6.1f} {d['country']} {str(d['rating']):>4}/{str(d['rating_count']):<4} {d['billing'][:8]:8} {d['name'][:58]:58} | {d['address']} | {d['phone']}")
