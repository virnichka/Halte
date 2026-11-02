#!/usr/bin/env python3
"""Test de bout en bout dans Chromium (Playwright) : premier lancement, carte plein écran et panneau du bas,
liste qui suit la carte, filtres, fiche lieu, géolocalisation simulée, « Vous y êtes », lecteur (mini et plein écran),
pause/reprise, réglages, mode sombre, petit écran. Les tuiles OSM ne sont pas joignables depuis le bac à sable."""
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
OUT = Path("/tmp/shots")
OUT.mkdir(exist_ok=True)

FAKE_TTS = """
(function(){
  var timer=null, cur=null;
  window.__spoken=[];window.__wl=0;
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:function(){window.__wl++;return Promise.resolve({release:function(){return Promise.resolve();},addEventListener:function(){}});}}});
  window.SpeechSynthesisUtterance=function(t){this.text=t;};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    speak:function(u){cur=u;window.__spoken.push(u.text);
      timer=setTimeout(function(){u.onstart&&u.onstart({});
        timer=setTimeout(function(){var f=u.onend;cur=null;f&&f({});},120);},10);},
    cancel:function(){clearTimeout(timer);var u=cur;cur=null;if(u&&u.onerror)u.onerror({error:'canceled'});},
    getVoices:function(){return [{lang:'fr-FR',name:'Voix de test',voiceURI:'fake',localService:true}];},
    addEventListener:function(){}
  }});
})();
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(APP), **k)

    def log_message(self, *a):
        pass


def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/index.html"
    errors, checks = [], []

    def check(name, cond):
        checks.append((name, bool(cond)))
        print(("PASS " if cond else "FAIL ") + name)

    def watch(pg):
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "tile.openstreetmap" not in m.text
              and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)

    def sheet_state(pg):
        return pg.get_attribute("#sheet", "data-state")

    def expand(pg):
        if sheet_state(pg) == "peek":
            pg.click("#sheet-handle")
            pg.wait_for_function("document.querySelector('#sheet').dataset.state !== 'peek'")
            pg.wait_for_timeout(300)

    def collapse(pg):
        if sheet_state(pg) != "peek":
            pg.click("#sheet-handle")
            pg.wait_for_function("document.querySelector('#sheet').dataset.state === 'peek'")
            pg.wait_for_timeout(300)

    def open_demo(pg, place):
        pg.click("#btn-settings")
        if not pg.evaluate("document.querySelector('#test-box').open"):
            pg.click("#test-box summary")
        pg.select_option("#opt-sim", place)

    def swipe(pg, sel, dy, steps=8):
        """Glisse un doigt (vrais événements tactiles) depuis le centre haut de `sel`, de `dy` pixels."""
        bb = pg.locator(sel).first.bounding_box()
        x, y = bb["x"] + bb["width"] / 2, bb["y"] + min(30, bb["height"] / 2)
        cdp = pg.context.new_cdp_session(pg)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + dy * i / steps}]})
            pg.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        cdp.detach()
        pg.wait_for_timeout(400)

    def home(pg):
        pg.wait_for_function("window.__halte.S.view === 'home' && !document.querySelector('#view-home').hidden", timeout=5000)

    mobile = dict(viewport={"width": 390, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="fr-FR")

    with sync_playwright() as p:
        b = p.chromium.launch()

        # --- Phase 0 : premier lancement sans localisation ---
        ctx0 = b.new_context(**mobile)
        p0 = ctx0.new_page()
        watch(p0)
        p0.goto(url)
        p0.wait_for_selector("#welcome:not([hidden])", timeout=5000)
        check("nom « Halte » (titre de page et en-tête)", "Halte" in p0.inner_text("h1") and p0.title() == "Halte")
        check("premier lancement : écran d'accueil", p0.locator("#welcome").is_visible() and "Me localiser" in p0.inner_text("#welcome"))
        p0.screenshot(path=str(OUT / "0_accueil_premier_lancement.png"))
        p0.click("#welcome-skip")
        check("« Explorer la carte d'abord » ferme l'accueil", p0.locator("#welcome").is_hidden())
        p0.wait_for_selector("#peek [data-act=locate]")
        check("plus de liste de villes", p0.locator("#city").count() == 0)
        check("panneau replié : bouton « Me localiser »", "Me localiser" in p0.inner_text("#peek") and sheet_state(p0) == "peek")
        check("vue de la France : 31 lieux dans la liste", p0.locator("#list .place").count() == 31)
        check("31 pastilles (aucune filtrée)", p0.locator("#map .pin:not([hidden])").count() == 31)
        check("pastilles regroupées avec un nombre", p0.locator("#map .cluster:not([hidden])").count() >= 3)
        nums = p0.locator("#map .cluster:not([hidden])").all_inner_texts()
        check("total des regroupements cohérent", sum(int(n) for n in nums) + p0.locator("#map .pin:not([hidden]):not(.clustered)").count() == 31)
        check("pastilles : icônes dessinées (plus d'émojis ni de numéros)",
              p0.locator("#map .pin svg use").count() == 31 and not any(t.strip() for t in p0.locator("#map .pin").all_inner_texts()))
        check("tuiles demandées", p0.locator(".tm-tile").count() > 0)
        p0.screenshot(path=str(OUT / "0b_france.png"))

        # Panneau : 3 hauteurs
        p0.click("#peek [data-act=expand]")
        p0.wait_for_timeout(350)
        check("« Voir la liste » agrandit le panneau", sheet_state(p0) == "half")
        check("liste : nom, accroche et bouton « Écouter »", p0.locator("#list .place").first.locator("[data-act=play]").count() == 1
              and p0.locator("#list .place__name").first.inner_text() != "")
        p0.screenshot(path=str(OUT / "0c_liste.png"))
        hb = p0.locator("#sheet-handle").bounding_box()
        p0.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        p0.mouse.down()
        for i in range(1, 9):
            p0.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2 - 40 * i)
        p0.mouse.up()
        p0.wait_for_timeout(350)
        check("glisser la poignée vers le haut : plein écran", sheet_state(p0) == "full")
        p0.click("#sheet-handle")
        p0.wait_for_timeout(350)
        check("toucher la poignée : panneau replié", sheet_state(p0) == "peek")
        expand(p0)
        p0.click("#list-collapse")
        p0.wait_for_timeout(350)
        check("bouton « Réduire la liste » : panneau replié", sheet_state(p0) == "peek")
        swipe(p0, "#peek", -260)
        check("doigt vers le haut sur le panneau : liste agrandie", sheet_state(p0) in ("half", "full"))
        swipe(p0, "#list .place", 320)
        check("doigt vers le bas sur la liste (en haut) : panneau replié", sheet_state(p0) == "peek")
        expand(p0)
        p0.mouse.click(200, 80)
        p0.wait_for_timeout(350)
        check("toucher la carte : la liste se replie", sheet_state(p0) == "peek")

        z0 = p0.evaluate("window.__halte.map.z")
        p0.evaluate("""(function(){var c=[].slice.call(document.querySelectorAll('#map .cluster:not([hidden])'));
          c.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top;});c[0].click();})()""")
        p0.wait_for_timeout(300)
        check("toucher un regroupement zoome dessus", p0.evaluate("window.__halte.map.z") > z0)

        # Zoomer sur Paris : la liste suit la carte
        p0.evaluate("""(function(h){var pts=h.S.places.filter(function(p){return p.city==='paris';});h.map.fitPoints(pts);})(window.__halte)""")
        p0.wait_for_timeout(400)
        check("carte sur Paris : 10 lieux dans la liste", p0.locator("#list .place").count() == 10)
        check("en-tête de liste : « 10 lieux »", "10 lieux" in p0.text_content("#list-sub"))
        expand(p0)
        p0.click("#cats [data-cat-filter='wtf']")
        p0.wait_for_timeout(200)
        check("filtre WTF à Paris", 0 < p0.locator("#list .place").count() < 10)
        check("filtre WTF : 9 pastilles au total", p0.locator("#map .pin:not([hidden])").count() == 9)
        check("filtre WTF : puce active", p0.get_attribute("#cats [data-cat-filter='wtf']", "aria-pressed") == "true")
        p0.click("#cats [data-cat-filter='all']")
        # Zone sans lieu : on propose le plus proche
        p0.evaluate("window.__halte.map.setView(45.76, 4.84, 13)")
        p0.wait_for_timeout(400)
        check("zone vide (Lyon) : message + lieu le plus proche", p0.locator("#list .place").count() == 0 and p0.locator("#list .goto").count() == 1)
        p0.screenshot(path=str(OUT / "1d_zone_vide.png"))
        goto_name = p0.inner_text("#list .goto")
        p0.click("#list .goto")
        p0.wait_for_selector("#view-place:not([hidden])")
        p0.wait_for_timeout(400)
        check("« Voir le plus proche » ouvre sa fiche", p0.inner_text("#place .place-title") in goto_name)
        check("fiche : pastille sélectionnée sur la carte", p0.locator("#map .pin.pin--sel").count() == 1)
        check("fiche : la carte se centre sur le lieu", p0.evaluate(
            "(function(h){var p=h.S.places.filter(function(x){return x.id===h.S.selected;})[0];return h.map.inView(p.lat,p.lon,0);})(window.__halte)"))
        p0.click("#place [data-act=close]")
        home(p0)
        check("fermer la fiche : retour à la liste", p0.locator("#map .pin.pin--sel").count() == 0)
        # Réouverture : on retrouve la dernière zone regardée, sans écran d'accueil
        zsaved = p0.evaluate("window.__halte.map.z")
        p0.reload()
        p0.wait_for_selector("#peek .peek")
        p0.wait_for_timeout(400)
        check("réouverture : dernière zone conservée", p0.evaluate("window.__halte.map.z") == zsaved)
        check("réouverture : pas d'écran d'accueil", p0.locator("#welcome").is_hidden())
        ctx0.close()

        # --- Phase A : localisation déjà autorisée (au Capitole) ---
        ctx = b.new_context(**mobile, geolocation={"latitude": 43.6045, "longitude": 1.4440, "accuracy": 15}, permissions=["geolocation"])
        page = ctx.new_page()
        watch(page)
        page.goto(url)
        page.wait_for_selector("#peek .badge--here", timeout=8000)
        page.wait_for_timeout(300)
        check("localisation relancée toute seule (déjà autorisée)", page.evaluate("window.__halte.S.tracking"))
        check("pas d'écran d'accueil si la localisation est déjà autorisée", page.locator("#welcome").is_hidden())
        check("« Vous y êtes » : Le Capitole dans le panneau", "Le Capitole" in page.inner_text("#peek .place-title"))
        check("pas d'alerte de proximité (ni bandeau ni fenêtre)", page.locator("#banner, .banner").count() == 0)
        check("écouter le lieu en 1 toucher (bouton dans le panneau replié)", page.locator("#peek [data-act=play][data-mode=express]").is_visible())
        check("liste triée : Capitole en premier, mis en avant", "Le Capitole" in page.locator("#list .place").first.text_content()
              and "is-here" in page.locator("#list .place").first.get_attribute("class"))
        check("pastille du lieu : anneau « vous y êtes »", page.locator("#map .pin.is-here[data-id='capitole']").count() == 1)
        check("point « vous êtes ici » visible", page.locator(".me").is_visible())
        check("la carte suit la position (bouton actif)", page.get_attribute("#btn-locate", "aria-pressed") == "true")
        page.screenshot(path=str(OUT / "1_accueil_localise.png"))

        # Fiche depuis une pastille
        page.locator("#map .pin[data-id='taur']").click()
        page.wait_for_selector("#view-place:not([hidden])")
        page.wait_for_timeout(400)
        check("toucher une pastille ouvre la fiche", "Notre-Dame du Taur" in page.inner_text("#place .place-title"))
        check("fiche : catégories, distance, Écouter, Version longue",
              page.locator("#place .tag").count() == 2 and " m" in page.inner_text("#place .place-meta")
              and page.locator("#place [data-mode=express]").count() == 1 and page.locator("#place [data-mode=histoire]").count() == 1)
        href = page.get_attribute("#place a.btn", "href") or ""
        check("fiche : itinéraire à pied vers l'app de cartes", "43.6061" in href and ("walking" in href or "dirflg=w" in href))
        page.click("#place .sources summary")
        check("fiche : sources (4)", page.locator("#place .sources li a").count() == 4)
        page.screenshot(path=str(OUT / "2_fiche.png"))
        page.click("#place .sources summary")
        swipe(page, "#place .place-tagline", 260)
        page.wait_for_function("window.__halte.S.view === 'home'", timeout=3000)
        check("doigt vers le bas sur la fiche : elle se ferme", page.locator("#view-place").is_hidden())
        page.locator("#map .pin[data-id='taur']").click()
        page.wait_for_selector("#view-place:not([hidden])")
        page.wait_for_timeout(400)
        page.go_back()
        home(page)
        check("bouton « retour » du téléphone : ferme la fiche sans quitter l'app", page.url.endswith("/index.html") and page.locator("#view-place").is_hidden())

        # Lecture sans voix (cas réel du navigateur de test) : repli propre en « texte seul »
        page.click("#peek [data-act=play][data-mode=express]")
        page.wait_for_selector("#mini:not([hidden])")
        check("mini-lecteur affiché", page.locator("#mini").is_visible() and "Le Capitole" in page.inner_text("#mini"))
        page.wait_for_function("window.__halte.S.player.state === 'error'", timeout=8000)
        page.wait_for_selector("#player.open")
        page.wait_for_timeout(350)
        check("sans voix : le texte s'ouvre en plein écran", page.locator("#player").is_visible())
        check("texte du récit dans le lecteur", "capitouls" in page.inner_text("#pl-text"))
        note = page.inner_text("#pl-note")
        check("sans voix : message clair, sans code technique", page.locator("#pl-note").is_visible() and "synthesis" not in note and "texte" in note)
        page.screenshot(path=str(OUT / "3_lecteur_sans_voix.png"))
        page.click("#pl-stop")
        page.wait_for_function("document.querySelector('#player').hidden && document.querySelector('#mini').hidden", timeout=5000)
        check("« Arrêter » ferme le lecteur et le mini-lecteur", True)

        # Mode démo : se placer près du Pont-Neuf
        open_demo(page, "pont-neuf")
        page.wait_for_function("document.querySelector('#peek .place-title') && /Pont-Neuf/.test(document.querySelector('#peek .place-title').textContent)", timeout=5000)
        check("démo : « Vous y êtes » au Pont-Neuf", page.locator("#peek .badge--here").count() == 1)
        check("démo : les réglages se ferment", not page.evaluate("document.querySelector('#settings').open"))
        page.screenshot(path=str(OUT / "5_demo_pont_neuf.png"))

        # Version longue depuis une fiche
        page.evaluate("window.__halte.openPlace('daurade')")
        page.wait_for_selector("#view-place:not([hidden])")
        page.click("#place [data-act=play][data-mode=histoire]")
        page.wait_for_selector("#mini:not([hidden])")
        n = page.locator("#pl-text span[data-i]").count()
        check("récit long découpé en plusieurs segments", n >= 4)
        page.wait_for_function("window.__halte.S.player.state === 'error'", timeout=8000)
        page.wait_for_selector("#player.open")
        page.click("#pl-stop")
        page.wait_for_function("document.querySelector('#player').hidden", timeout=5000)
        page.click("#place [data-act=close]")
        home(page)

        # Mode démo dans une autre ville : la carte s'y déplace
        open_demo(page, "paris-zouave")
        page.wait_for_function("/Zouave/.test(document.querySelector('#peek').textContent)", timeout=5000)
        page.wait_for_timeout(400)
        check("démo Paris : la carte suit", "Zouave" in page.locator("#list .place").first.text_content())
        check("démo Paris : « Vous y êtes » au Zouave", page.locator("#peek .badge--here").count() == 1)
        expand(page)
        page.click("#cats [data-cat-filter='secret']")
        page.wait_for_timeout(400)
        rows = page.locator("#list .place:not(.is-here)").count()
        check("filtre Caché à Paris : le plus proche proposé, distances affichées",
              page.locator("#peek [data-act=play]").count() >= 1 and rows > 0 and page.locator("#list .place:not(.is-here) .d").count() == rows)
        page.click("#cats [data-cat-filter='all']")
        collapse(page)
        page.screenshot(path=str(OUT / "5b_demo_paris.png"))

        # Zoom au double toucher
        z1 = page.evaluate("window.__halte.map.z")
        page.dblclick("#map", position={"x": 200, "y": 200})
        page.wait_for_timeout(200)
        check("double toucher sur la carte : zoom avant", page.evaluate("window.__halte.map.z") == min(18, z1 + 1))
        check("pas de débordement horizontal", not page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"))
        ctx.close()

        # --- Phase B : synthèse vocale simulée (pause, reprise, progression, fin, lieu suivant) ---
        ctx2 = b.new_context(**mobile)
        ctx2.add_init_script(FAKE_TTS)
        pg = ctx2.new_page()
        watch(pg)
        pg.goto(url)
        pg.wait_for_selector("#welcome:not([hidden])")
        pg.click("#welcome-skip")
        pg.evaluate("window.__halte.openPlace('pont-neuf')")
        pg.wait_for_selector("#view-place:not([hidden])")
        pg.click("#place [data-act=play][data-mode=histoire]")
        pg.wait_for_selector("#mini:not([hidden])")
        check("écran maintenu allumé pendant l'écoute", pg.evaluate("window.__wl") >= 1)
        check("voix disponible : on reste sur la carte, mini-lecteur seulement", pg.locator("#player").is_hidden())
        pg.wait_for_function("window.__halte.S.player.i >= 1", timeout=5000)
        check("lecture : progression segment par segment", pg.evaluate("window.__halte.S.player.i") >= 1)
        check("fiche : le bouton devient « Pause »", "Pause" in pg.inner_text("#place [data-mode=histoire]"))
        pg.click("#mini-toggle")
        pg.wait_for_timeout(100)
        i_pause = pg.evaluate("window.__halte.S.player.i")
        check("pause prise en compte (mini-lecteur)", pg.evaluate("window.__halte.S.player.state") == "paused")
        check("mini-lecteur : « En pause » et temps restant", "En pause" in pg.inner_text("#mini-sub") and "reste" in pg.inner_text("#mini-sub"))
        pg.wait_for_timeout(600)
        check("pause : plus de progression", pg.evaluate("window.__halte.S.player.i") == i_pause)
        pg.click("#mini-toggle")
        pg.wait_for_function("window.__halte.S.player.i > %d" % i_pause, timeout=5000)
        check("reprise : continue au segment suivant", pg.evaluate("window.__halte.S.player.i") > i_pause)
        spoken = pg.evaluate("window.__spoken")
        repeats = sum(1 for a, b2 in zip(spoken, spoken[1:]) if a == b2)
        check("seul le segment interrompu par la pause est relu", repeats <= 1 and len(spoken) >= 3)
        pg.click("#mini-open")
        pg.wait_for_selector("#player.open")
        pg.wait_for_timeout(350)
        check("toucher le mini-lecteur : lecteur plein écran", pg.locator("#player").is_visible())
        check("lecteur : phrase en cours surlignée et temps restant", pg.locator("#pl-text span.cur").count() == 1 and "−" in pg.inner_text("#pl-remain"))
        pg.click("#pl-speed")
        check("vitesse : 1× → 1,15× (aussi dans les réglages)", pg.evaluate("window.__halte.S.rate") == 1.15
              and "1,15" in pg.inner_text("#pl-speed") and pg.get_attribute("#opt-rate [data-rate='1.15']", "aria-pressed") == "true")
        i_now = pg.evaluate("window.__halte.S.player.i")
        pg.click("#pl-fwd")
        check("« phrase suivante »", pg.evaluate("window.__halte.S.player.i") >= min(i_now + 1, pg.evaluate("window.__halte.S.player.chunks.length") - 1))
        pg.wait_for_function("window.__halte.S.player.state === 'done'", timeout=20000)
        check("fin de lecture détectée", pg.evaluate("window.__halte.S.player.state") == "done")
        pg.wait_for_selector("#pl-go", timeout=3000)
        check("suggestion du lieu suivant après l'écoute", "Prochain lieu" in pg.inner_text("#pl-go"))
        pg.screenshot(path=str(OUT / "7_lieu_suivant.png"))
        pg.click("#pl-go")
        pg.wait_for_function("document.querySelector('#player').hidden && window.__halte.S.view === 'place'", timeout=5000)
        check("« Prochain lieu » ferme le lecteur et ouvre sa fiche",
              pg.evaluate("window.__halte.S.selected") not in (None, "pont-neuf") and pg.locator("#mini").is_hidden())
        check("lieu marqué comme écouté", "pont-neuf" in pg.evaluate("Array.from(window.__halte.S.visited)"))
        check("pastille : badge ✓ (la couleur de catégorie reste)", pg.locator("#map .pin.is-done").count() == 1
              and pg.get_attribute("#map .pin.is-done", "data-cat") is not None)
        pg.screenshot(path=str(OUT / "6_fin_lecture.png"))
        # Réglages : effacer les lieux écoutés, avec confirmation
        pg.click("#place [data-act=close]")
        home(pg)
        pg.click("#btn-settings")
        check("réglages : nombre de lieux écoutés", "1 lieu écouté" in pg.inner_text("#visited-count"))
        pg.click("#btn-reset")
        check("effacer : demande de confirmation", pg.locator("#reset-confirm").is_visible()
              and pg.evaluate("Array.from(window.__halte.S.visited).length") == 1)
        pg.screenshot(path=str(OUT / "8_reglages.png"))
        pg.click("#reset-yes")
        check("effacer : lieux écoutés remis à zéro", pg.evaluate("Array.from(window.__halte.S.visited).length") == 0
              and pg.locator("#map .pin.is-done").count() == 0)
        ctx2.close()

        # --- Phase C : petit écran (360 px), mode sombre, cibles tactiles ---
        ctx3 = b.new_context(viewport={"width": 360, "height": 640}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="fr-FR",
                             color_scheme="dark", geolocation={"latitude": 43.6062, "longitude": 1.4460, "accuracy": 15}, permissions=["geolocation"])
        p3 = ctx3.new_page()
        watch(p3)
        p3.goto(url)
        p3.wait_for_selector("#peek [data-act=play]", timeout=8000)
        p3.wait_for_timeout(500)
        check("360 px : pas de débordement horizontal", not p3.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"))
        bb = p3.locator("#peek [data-act=play][data-mode=express]").bounding_box()
        check("360 × 640 : « Écouter » visible sans faire défiler", bb is not None and bb["y"] + bb["height"] <= 640)
        check("mode sombre suivi (fond sombre)", p3.evaluate(
            "(function(){var c=getComputedStyle(document.querySelector('#sheet')).backgroundColor.match(/\\d+/g).map(Number);return c[0]+c[1]+c[2] < 150;})()"))
        small = p3.evaluate("""(function(){var bad=[];['#btn-settings','#btn-locate','#sheet-handle','#peek .btn','#cats .chip','#list .icon-btn','#map .pin:not([hidden]):not(.clustered)']
          .forEach(function(s){[].forEach.call(document.querySelectorAll(s),function(e){var r=e.getBoundingClientRect();
          if(r.width&&r.height&&(r.width<43.5||r.height<43.5))bad.push(s+' '+Math.round(r.width)+'x'+Math.round(r.height));});});return bad;})()""")
        check("cibles tactiles d'au moins 44 px" + (" : " + ", ".join(small[:4]) if small else ""), not small)
        p3.screenshot(path=str(OUT / "9_sombre_360.png"))
        ctx3.close()

        b.close()

    srv.shutdown()
    check("aucune erreur JavaScript", not errors)
    for e in errors:
        print("   JS:", e)
    failed = [n for n, ok in checks if not ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} vérifications OK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
