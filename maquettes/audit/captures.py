"""Captures d'écran de l'app (audit avant/après). Usage : python3 maquettes/audit/captures.py
Les PNG vont dans /tmp/halte-captures. Tuiles OSM via le proxy HTTPS s'il existe."""
import http.server, socketserver, threading, os, sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app"
OUT = Path("/tmp/halte-captures"); OUT.mkdir(exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=str(APP),**k)
    def log_message(s,*a): pass
srv = socketserver.TCPServer(("127.0.0.1",0),Q); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f"http://127.0.0.1:{port}/index.html"
proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1,localhost"} if os.environ.get("HTTPS_PROXY") else None
FAKE_TTS = """
(function(){var timer=null,cur=null;
window.SpeechSynthesisUtterance=function(t){this.text=t;};
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
 speak:function(u){cur=u;timer=setTimeout(function(){u.onstart&&u.onstart({});timer=setTimeout(function(){var f=u.onend;cur=null;f&&f({});},%d);},10);},
 cancel:function(){clearTimeout(timer);var u=cur;cur=null;if(u&&u.onerror)u.onerror({error:'canceled'});},
 getVoices:function(){return [{lang:'fr-FR',name:'Voix',voiceURI:'v',localService:true}];},addEventListener:function(){}}});})();
"""
def ctx(b, w=360, h=780, geo=None, dark=False, tts=None):
    kw=dict(viewport={"width":w,"height":h},device_scale_factor=2,is_mobile=True,has_touch=True,locale="fr-FR",
            color_scheme="dark" if dark else "light")
    if geo: kw.update(geolocation=geo,permissions=["geolocation"])
    c=b.new_context(**kw)
    if tts is not None: c.add_init_script(FAKE_TTS % tts)
    return c
def wait_tiles(p):
    p.wait_for_timeout(2500)
with sync_playwright() as pw:
    b=pw.chromium.launch(proxy=proxy) if proxy else pw.chromium.launch()
    # 1. premier lancement, 360 px
    c=ctx(b); p=c.new_page(); p.goto(URL); p.wait_for_selector(".card"); wait_tiles(p)
    p.screenshot(path=str(OUT/"01_premier_lancement_360.png"))
    # mesures
    m=p.evaluate("""()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.width),Math.round(b.height)]};
      return {locate:r('#btn-locate'),settings:r('#btn-settings'),zoom:r('#zin'),chip:r('#cats button'),marker:r('.tm-marker:not(.clustered)'),cluster:r('.tm-cluster:not([hidden])'),
      more:r('.card .more'),map:r('#map'),list:r('#list'),chipsScroll:[document.querySelector('#cats').scrollWidth,document.querySelector('#cats').clientWidth],
      cards:document.querySelectorAll('.card').length, emojis:[...document.querySelectorAll('.tm-ico')].slice(0,3).map(e=>e.textContent)}}""")
    print(json.dumps(m))
    # 2. Toulouse zoomée + lieu sélectionné
    p.evaluate("(h=>{h.map.fitPoints(h.S.places.filter(p=>p.city==='toulouse'))})(window.__halte)"); wait_tiles(p)
    p.screenshot(path=str(OUT/"02_toulouse_360.png"))
    p.evaluate("(h=>{h.map.setView(43.6045,1.444,16)})(window.__halte)"); p.wait_for_timeout(1500)
    p.evaluate("(h=>{var c=h.S.places.find(p=>p.id==='capitole');h.map.setView(c.lat,c.lon,16)})(window.__halte)"); p.wait_for_timeout(800); p.locator(".tm-marker[aria-label='Le Capitole']").click(); wait_tiles(p)
    p.screenshot(path=str(OUT/"03_lieu_touche_360.png"))
    # 4. réglages
    p.click("#btn-settings"); p.wait_for_timeout(300)
    p.screenshot(path=str(OUT/"04_reglages_360.png")); p.keyboard.press("Escape")
    # 5. filtres scroll : fin
    c.close()
    # 6. localisé au Capitole, proximité
    c=ctx(b,geo={"latitude":43.6045,"longitude":1.4440,"accuracy":15}); p=c.new_page(); p.goto(URL)
    p.wait_for_selector(".banner:not([hidden])",timeout=8000); wait_tiles(p)
    p.screenshot(path=str(OUT/"05_proximite_360.png"))
    # 7. lecteur sans voix (navigateur de test)
    p.click("#banner button[data-b='express']"); p.wait_for_function("window.__halte.S.player.state==='error'",timeout=8000); p.wait_for_timeout(300)
    p.screenshot(path=str(OUT/"06_lecteur_sans_voix_360.png"))
    c.close()
    # 8. lecteur avec voix simulée (lent), texte fermé puis ouvert
    c=ctx(b,geo={"latitude":43.6045,"longitude":1.4440,"accuracy":15},tts=60000); p=c.new_page(); p.goto(URL)
    p.wait_for_selector(".banner:not([hidden])",timeout=8000); wait_tiles(p)
    p.click("#banner button[data-b='histoire']"); p.wait_for_timeout(800)
    p.screenshot(path=str(OUT/"07_lecteur_lecture_360.png"))
    p.click(".player summary"); p.wait_for_timeout(300)
    p.screenshot(path=str(OUT/"08_lecteur_texte_360.png"))
    c.close()
    # 9. fin de lecture
    c=ctx(b,tts=80); p=c.new_page(); p.goto(URL); p.wait_for_selector(".card")
    p.evaluate("(h=>{h.map.fitPoints(h.S.places.filter(p=>p.city==='paris'))})(window.__halte)"); wait_tiles(p)
    p.locator(".card").first.locator("button[data-mode='express']").click()
    p.wait_for_function("window.__halte.S.player.state==='done'",timeout=20000); p.wait_for_timeout(1500)
    p.screenshot(path=str(OUT/"09_fin_ecoute_360.png"))
    c.close()
    # 10. mode sombre demandé
    c=ctx(b,dark=True); p=c.new_page(); p.goto(URL); p.wait_for_selector(".card"); wait_tiles(p)
    p.screenshot(path=str(OUT/"10_mode_sombre_360.png")); c.close()
    # 11. grand écran 412
    c=ctx(b,w=412,h=915,geo={"latitude":48.8606,"longitude":2.3376,"accuracy":15}); p=c.new_page(); p.goto(URL); p.wait_for_selector(".cta"); wait_tiles(p)
    p.screenshot(path=str(OUT/"11_paris_localise_412.png")); c.close()
    # 12. scroll de liste en vue France
    c=ctx(b); p=c.new_page(); p.goto(URL); p.wait_for_selector(".card"); wait_tiles(p)
    p.evaluate("document.querySelector('#list').scrollTop=900"); p.wait_for_timeout(300)
    p.screenshot(path=str(OUT/"12_liste_defilee_360.png")); c.close()
    b.close()
srv.shutdown()
