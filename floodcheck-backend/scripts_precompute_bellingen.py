import json, math, os, time
import httpx
from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree
from shapely.ops import transform

UA={"User-Agent":"floodcheck-precompute (research)"}
FS="https://services7.arcgis.com/kkiBaYsUIhK1wEpz/arcgis/rest/services/Lower_Bellinger_and_Kalang_Rivers_Floodplain_Risk_Management_Study/FeatureServer"
ELEV="https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/getSamples"
EVENTS=[(2,"Level_5ARI","yr5_ari"),(3,"Level_5AEP","aep5_20yr"),(4,"Level_1AEP","aep1_100yr"),(6,"Level_FPA","fpa"),(7,"Level_PMF","pmf")]
OUT=r"C:\Users\manoj\Desktop\EmberCheck\floodcheck-frontend\public"
c=httpx.Client(timeout=300,headers=UA)

def area_m2(poly):
    lat0=poly.centroid.y; sx=111320*math.cos(math.radians(lat0)); sy=110540
    return transform(lambda x,y,z=None:(x*sx,y*sy), poly).area

# ---- 1) ALL buildings in Bellingen Shire (OSM admin area) ----
q='[out:json][timeout:120];area["admin_level"="6"]["name"="Bellingen Shire Council"]->.a;way["building"](area.a);out geom;'
els=None
for ep in ["https://maps.mail.ru/osm/tools/overpass/api/interpreter","https://overpass.kumi.systems/api/interpreter"]:
    try:
        rr=c.post(ep,data={"data":q})
        if rr.status_code==200 and rr.text.strip().startswith("{"): els=rr.json()["elements"]; break
    except Exception as e: print("overpass",ep.split("/")[2],"ERR",str(e)[:60])
if els is None: raise SystemExit("overpass failed")
buildings=[]
for e in els:
    g=e.get("geometry")
    if not g or len(g)<4: continue
    ring=[(p["lon"],p["lat"]) for p in g]
    if ring[0]!=ring[-1]: ring.append(ring[0])
    try: poly=Polygon(ring)
    except Exception: continue
    if not poly.is_valid or poly.area==0: continue
    t=e.get("tags",{}); h=None
    if t.get("height"):
        try: h=float(str(t["height"]).split()[0])
        except Exception: pass
    if h is None and t.get("building:levels"):
        try: h=float(t["building:levels"])*3.1
        except Exception: pass
    buildings.append({"poly":poly,"height":h or 6.0,"tags":t})
print("buildings (whole shire):",len(buildings))

# ---- 2) flood event polygons: FULL layers, paginated ----
event_trees={}
for lid,field,key in EVENTS:
    polys=[]; vals=[]; offset=0
    while True:
        params={"where":"1=1","outFields":field,"returnGeometry":"true","outSR":4326,
                "f":"geojson","geometryPrecision":6,"resultOffset":offset,"resultRecordCount":500}
        t1=time.time(); jd=c.get(f"{FS}/{lid}/query",params=params).json(); print(f"  layer {lid} offset {offset}: {len(jd.get(chr(39)+chr(102)+chr(101)+chr(97)+chr(116)+chr(117)+chr(114)+chr(101)+chr(115)+chr(39),[]))} feats in {time.time()-t1:.0f}s",flush=True)
        feats=jd.get("features",[])
        for f in feats:
            geom=f.get("geometry")
            if not geom: continue
            try: gg=shape(geom)
            except Exception: continue
            parts=list(gg.geoms) if gg.geom_type=="MultiPolygon" else [gg]
            for pl in parts:
                if pl.is_valid and pl.area>0: polys.append(pl); vals.append(f["properties"].get(field))
        if not jd.get("properties",{}).get("exceededTransferLimit") and len(feats)<500: break
        offset+=500
        if offset>20000: break
    event_trees[key]=(STRtree(polys) if polys else None, polys, vals)
    print(f"event {key}: {len(polys)} polygon parts")

def level_at(pt,key):
    tree,polys,vals=event_trees[key]
    if not tree: return None
    for i in tree.query(pt):
        if polys[i].contains(pt): return vals[i]
    return None

# ---- 3) ground elevation, batched ----
cents=[b["poly"].representative_point() for b in buildings]
grounds=[None]*len(cents)
t0=time.time()
for i in range(0,len(cents),100):
    chunk=cents[i:i+100]
    geom={"points":[[p.x,p.y] for p in chunk],"spatialReference":{"wkid":4326}}
    for attempt in range(2):
        try:
            rr=c.get(ELEV,params={"geometry":json.dumps(geom),"geometryType":"esriGeometryMultipoint","returnFirstValueOnly":"true","f":"json"},timeout=60)
            for j,s in enumerate(rr.json().get("samples",[])):
                try: grounds[i+j]=round(float(s.get("value")),2)
                except Exception: pass
            break
        except Exception as e:
            if attempt: print("elev batch",i,"failed:",str(e)[:60])
print(f"elevations: {sum(1 for g in grounds if g is not None)}/{len(grounds)} in {time.time()-t0:.0f}s")

# ---- 4) classify + write ----
feats=[]; counts={"not":0,"parcel":0,"building":0}
for idx,(b,pt,g) in enumerate(zip(buildings,cents,grounds)):
    levels={key:level_at(pt,key) for _,_,key in EVENTS}
    lvl1=levels.get("aep1_100yr")
    depth1=round(lvl1-g,2) if (lvl1 is not None and g is not None) else None
    status="not" if lvl1 is None else ("building" if (depth1 is not None and depth1>0.2) else "parcel")
    counts[status]+=1
    feats.append({"type":"Feature","geometry":b["poly"].__geo_interface__,
        "properties":{"id":idx,"ground_m":g,"height_m":round(b["height"],1),
            "area_m2":round(area_m2(b["poly"]),1),"levels":levels,"depth_1aep":depth1,
            "status":status,"name":b["tags"].get("name")}})
open(fr"{OUT}\bellingen_buildings.geojson","w").write(json.dumps({"type":"FeatureCollection","features":feats}))
print("counts:",counts,"total",len(feats))

# ---- 5) water plane = full 1% AEP, simplified ----
tree,polys,vals=event_trees["aep1_100yr"]
wf=[]
for p,v in zip(polys,vals):
    sp=p.simplify(0.00005, preserve_topology=True)
    if sp.is_empty: continue
    wf.append({"type":"Feature","geometry":sp.__geo_interface__,"properties":{"level":v}})
open(fr"{OUT}\bellingen_flood_1aep.geojson","w").write(json.dumps({"type":"FeatureCollection","features":wf}))
print("water parts:",len(wf),
      "| water bytes:",os.path.getsize(fr"{OUT}\bellingen_flood_1aep.geojson"),
      "| buildings bytes:",os.path.getsize(fr"{OUT}\bellingen_buildings.geojson"))
