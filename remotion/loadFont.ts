import { continueRender, delayRender, staticFile } from "remotion";

// Carrega a Montserrat Black do public/fonts (mesma fonte da capa).
// Segura o render até a fonte estar pronta (evita flash de fallback no frame 0).
let carregada = false;

export function ensureMontserrat() {
  if (carregada || typeof document === "undefined") return;
  carregada = true;
  const handle = delayRender("Carregando Montserrat");
  const font = new FontFace(
    "Montserrat",
    `url(${staticFile("fonts/Montserrat-Black.ttf")}) format("truetype")`,
    { weight: "900" }
  );
  font
    .load()
    .then((f) => {
      document.fonts.add(f);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
}
