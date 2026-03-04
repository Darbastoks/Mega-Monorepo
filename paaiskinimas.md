# Kaip veikia Mega-Monorepo plėtra (Naujų puslapių kėlimas)

Štai atsakymas, kodėl tau **niekada** nebereikės kurti naujo `Github` projekto ar mokėti papildomų 7$ per mėnesį `Render` platformai, norint pridėti naują svetainę (pvz., picerijai).

## ❌ Senasis būdas (Kainuojantis pinigus)
1. Kuriame naują Github projektą `picerija-website`.
2. Einame į Render.com.
3. Spaudžiame "New Web Service".
4. Prijungiame `picerija-website`.
5. **Rezultatas:** Gauname naują sąskaitą 7$/mėn.

## ✅ Naujasis būdas (NEMOKAMAS, per Mega-Monorepo)
Vietoje to, kad kurtume kažką naujo, mes tiesiog **papildome** jau esamą ir apmokėtą serverį:

1. Aš suprogramuoju picerijos kodą tavo kompiuteryje.
2. Įkeliu jį į esamo `Velora-Monorepo` vidinę papkutę: `/public/pica`.
3. Terminale parašau stebuklingą komandą: `git push`.
4. Render platforma pamato, kad senajame Github projekte atsirado naujų failų ir tiesiog juos **atsisiunčia / atnaujina** serverį.

**Rezultatas:** Picerijos puslapis akimirksniu tampa pasiekiamas adresu `https://velora-mega-server.onrender.com/pica`. Naujo Github projekto nėra. Naujo Render projekto nėra. Naujo mokesčio nėra. 

Vienas apmokėtas serveris dabar gali talpinti tūkstančius tokių puslapių! 🚀
