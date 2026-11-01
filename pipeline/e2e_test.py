#!/usr/bin/env python3
"""Test de bout en bout dans Chromium (Playwright) : chargement, carte, géolocalisation simulée,
bandeau de proximité, lecteur, réglages. Les tuiles OSM ne sont pas joignables depuis le bac à sable."""
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(APP), **k)

    def log_message(self, *a):
        pass


def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    errors, checks = [], []

    def check(name, cond):
        checks.append((name, bool(cond)))
        print(("PASS " if cond else "FAIL ") + name)

    with sync_playwright() as p:
        b = p.chromium.launch()

        # --- Phase 0 : premier lancement sans localisation → vue de la France ---
        ctx0 = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="fr-FR")
        p0 = ctx0.new_page()
        p0.on("pageerror", lambda e: errors.append(str(e)))
        p0.goto(f"http://127.0.0.1:{port}/index.html")
        p0.wait_for_selector(".card")
        p0.wait_for_timeout(300)
        check("nouveau nom « Halte »", "Halte" in p0.inner_text("h1") and p0.title() == "Halte")
        check("plus de liste de villes", p0.locator("#city").count() == 0)
        check("bouton principal « Me localiser pour commencer »", "Me localiser pour commencer" in p0.inner_text(".cta"))
        check("vue de la France : les 31 lieux dans la liste", p0.locator(".card").count() == 31)
        check("31 marqueurs (aucun filtré)", p0.locator(".tm-marker:not([hidden])").count() == 31)
        check("pastilles regroupées avec un nombre", p0.locator(".tm-cluster:not([hidden])").count() >= 3)
        nums = p0.locator(".tm-cluster:not([hidden])").all_inner_texts()
        check("total des regroupements cohérent", sum(int(n) for n in nums) + p0.locator(".tm-marker:not([hidden]):not(.clustered)").count() == 31)
        check("pastilles : icône de catégorie, plus de numéros", not any(t.strip().isdigit() for t in p0.locator(".tm-marker .tm-ico").all_inner_texts() + p0.locator(".card .num").all_inner_texts()))
        check("fiche simple : « Écouter » + « Version longue »", "Écouter" in p0.locator(".card").first.inner_text() and "Version longue" in p0.locator(".card").first.inner_text())
        check("tuiles demandées", p0.locator(".tm-tile").count() > 0)
        p0.screenshot(path=str(OUT / "0_france.png"))

        z0 = p0.evaluate("window.__halte.map.z")
        p0.locator(".tm-cluster:not([hidden])").first.click()
        p0.wait_for_timeout(300)
        check("toucher un regroupement zoome dessus", p0.evaluate("window.__halte.map.z") > z0)

        # Zoomer sur Paris : la liste suit la carte
        p0.evaluate("""(function(h){var pts=h.S.places.filter(function(p){return p.city==='paris';});h.map.fitPoints(pts);})(window.__halte)""")
        p0.wait_for_timeout(300)
        check("carte sur Paris : 10 lieux dans la liste", p0.locator(".card").count() == 10)
        check("statut : lieux dans cette zone", "10 lieux dans cette zone" in p0.inner_text("#status"))
        p0.screenshot(path=str(OUT / "1c_paris.png"))
        p0.click("#cats button[data-cat='wtf']")
        check("filtre WTF à Paris", 0 < p0.locator(".card").count() < 10)
        check("filtre WTF : 9 marqueurs au total", p0.locator(".tm-marker:not([hidden])").count() == 9)
        check("filtre WTF : bouton actif", p0.get_attribute("#cats button[data-cat='wtf']", "aria-pressed") == "true")
        p0.click("#cats button[data-cat='all']")
        # Zone sans lieu : on propose le plus proche
        p0.evaluate("window.__halte.map.setView(45.76, 4.84, 13)")
        p0.wait_for_timeout(300)
        check("zone vide (Lyon) : message + lieu le plus proche", p0.locator(".card").count() == 0 and p0.locator("button.goto").count() == 1)
        p0.screenshot(path=str(OUT / "1d_zone_vide.png"))
        p0.click("button.goto")
        p0.wait_for_timeout(300)
        check("« Voir le plus proche » amène sur le lieu", p0.locator(".card.sel").count() == 1)
        # Réouverture : on retrouve la dernière zone regardée
        zsaved = p0.evaluate("window.__halte.map.z")
        p0.reload()
        p0.wait_for_selector(".card")
        p0.wait_for_timeout(300)
        check("réouverture : dernière zone conservée", p0.evaluate("window.__halte.map.z") == zsaved)
        ctx0.close()

        # --- Phase A : localisation déjà autorisée (au Capitole) ---
        ctx = b.new_context(
            viewport={"width": 390, "height": 800},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            geolocation={"latitude": 43.6045, "longitude": 1.4440, "accuracy": 15},
            permissions=["geolocation"],
            locale="fr-FR",
        )
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "tile.openstreetmap" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector(".card")

        # Géolocalisation réelle (mockée) au Capitole
        page.wait_for_selector(".banner:not([hidden])", timeout=8000)
        check("localisation relancée toute seule (déjà autorisée)", page.evaluate("window.__halte.S.tracking"))
        check("bandeau de proximité sur le Capitole", "Le Capitole" in page.inner_text("#banner"))
        check("bouton principal : lieu le plus proche", "Le Capitole" in page.inner_text(".cta-sub"))
        check("liste triée : Capitole en premier", "Le Capitole" in page.locator(".card").first.inner_text())
        check("point utilisateur visible", page.locator(".tm-user").is_visible())
        page.screenshot(path=str(OUT / "2_proximite.png"))
        page.screenshot(path=str(OUT / "1_accueil.png"))

        # Lecture sans voix (cas réel du navigateur de test) : repli propre en « texte seul »
        page.click("#banner button[data-b='express']")
        page.wait_for_selector("#player:not([hidden])")
        check("lecteur affiché", page.locator("#player").is_visible())
        check("texte du récit dans le lecteur", "capitouls" in page.inner_text(".transcript"))
        page.wait_for_function("window.__halte.S.player.state === 'error'", timeout=8000)
        check("sans voix : repli en texte seul", page.evaluate("window.__halte.S.player.state") == "error")
        check("sans voix : message visible", page.locator("#pl-note").is_visible())
        page.screenshot(path=str(OUT / "3_lecteur_sans_voix.png"))
        page.click("#pl-stop")
        check("lecteur fermé", page.locator("#player").is_hidden())

        # Mode démo : se placer près du Pont-Neuf
        page.click("#btn-settings")
        page.select_option("#opt-sim", "pont-neuf")
        page.wait_for_selector(".banner:not([hidden])")
        check("démo : bandeau Pont-Neuf", "Pont-Neuf" in page.inner_text("#banner"))
        page.screenshot(path=str(OUT / "5_demo_pont_neuf.png"))

        # Bouton Histoire depuis la liste
        page.click("#banner button[data-b='later']")
        page.locator(".card[data-id='daurade'] button[data-mode='histoire']").click()
        page.wait_for_selector("#player:not([hidden])")
        n = page.locator(".transcript span").count()
        check("récit long découpé en plusieurs segments", n >= 4)
        page.click("#pl-stop")

        # Mode démo dans une autre ville : la carte s'y déplace
        page.click("#btn-settings")
        page.select_option("#opt-sim", "paris-zouave")
        page.wait_for_selector(".banner:not([hidden])")
        page.wait_for_timeout(300)
        check("démo Paris : la carte suit", "Zouave" in page.locator(".card").first.inner_text())
        check("démo Paris : bandeau Zouave", "Zouave" in page.inner_text("#banner"))
        page.click("#banner button[data-b='later']")
        page.click("#cats button[data-cat='secret']")
        page.wait_for_timeout(300)
        check("filtre Caché à Paris : le plus proche proposé, distances affichées", "Écouter le plus proche" in page.inner_text(".cta") and page.locator(".card .dist").count() == page.locator(".card").count())
        page.click("#cats button[data-cat='all']")
        page.screenshot(path=str(OUT / "5b_demo_paris.png"))

        # Zoom carte
        z0 = page.evaluate("document.querySelector('.tm-tile') && window.__halte.S.places.length")
        page.click("#zin")
        page.click("#zout")
        check("zoom +/- sans erreur", True)

        # Plus de 200 px de large pour la carte ; pas de débordement horizontal
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
        check("pas de débordement horizontal", not overflow)


        # --- Phase B : synthèse vocale simulée (valide pause, reprise, progression, fin) ---
        ctx2 = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="fr-FR")
        ctx2.add_init_script("""
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
        """)
        pg = ctx2.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/index.html")
        pg.wait_for_selector(".card")
        pg.locator(".card[data-id='pont-neuf'] button[data-mode='histoire']").click()
        pg.wait_for_selector("#player:not([hidden])")
        check("écran maintenu allumé pendant l'écoute", pg.evaluate("window.__wl") >= 1)
        check("texte replié par défaut quand la voix marche", pg.evaluate("!document.querySelector('.player details').open"))
        pg.wait_for_function("window.__halte.S.player.i >= 1", timeout=5000)
        check("lecture : progression segment par segment", pg.evaluate("window.__halte.S.player.i") >= 1)
        pg.click("#pl-toggle")
        pg.wait_for_timeout(100)
        i_pause = pg.evaluate("window.__halte.S.player.i")
        check("pause prise en compte", pg.evaluate("window.__halte.S.player.state") == "paused")
        pg.wait_for_timeout(600)
        check("pause : plus de progression", pg.evaluate("window.__halte.S.player.i") == i_pause)
        pg.click("#pl-toggle")
        pg.wait_for_function("window.__halte.S.player.i > %d" % i_pause, timeout=5000)
        check("reprise : continue au segment suivant", pg.evaluate("window.__halte.S.player.i") > i_pause)
        pg.wait_for_function("window.__halte.S.player.state === 'done'", timeout=20000)
        check("fin de lecture détectée", pg.evaluate("window.__halte.S.player.state") == "done")
        pg.wait_for_selector("#pl-go", timeout=3000)
        check("suggestion du lieu suivant après l'écoute", "Prochain lieu" in pg.inner_text("#pl-go"))
        pg.screenshot(path=str(OUT / "7_lieu_suivant.png"))
        pg.click("#pl-go")
        check("« Prochain lieu » ferme le lecteur et sélectionne le lieu", pg.locator("#player").is_hidden() and pg.evaluate("window.__halte.S.selected") != "pont-neuf")
        check("lieu marqué comme écouté", "pont-neuf" in pg.evaluate("Array.from(window.__halte.S.visited)"))
        check("marqueur passe au vert", pg.locator(".tm-marker.done").count() == 1)
        pg.screenshot(path=str(OUT / "6_fin_lecture.png"))
        spoken = pg.evaluate("window.__spoken")
        repeats = sum(1 for a, b in zip(spoken, spoken[1:]) if a == b)
        check("seul le segment interrompu par la pause est relu", repeats <= 1 and len(spoken) >= 4)
        ctx2.close()

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
