"use client";

import React, { useState } from "react";
import { X, Printer, Tag, Download, Loader2 } from "lucide-react";

// ── Mapeamento: campos da tag → opcionais do sistema ──────────────────────────
const TAG_ITENS = [
  // Coluna 1
  { key: "ar_cond",     label: "AR COND.",              match: ["Ar condicionado", "Ar condicionado dual zone", "Ar quente"] },
  { key: "dir_hid",     label: "DIREÇÃO HID.",           match: ["Direção hidráulica", "Direção elétrica"] },
  { key: "vidros_elet", label: "VIDROS ELET.",           match: ["Vidros elétricos"] },
  { key: "travas_elet", label: "TRAVAS ELET.",           match: ["Trava elétrica"] },
  { key: "alarme",      label: "ALARME",                match: ["Alarme"] },
  { key: "rodas",       label: "RODAS",                 match: ["Rodas de liga leve"] },
  // Coluna 2
  { key: "b_couro",     label: "B. COURO",              match: ["Bancos em couro"] },
  { key: "camb_aut",    label: "CAMB. AUT.",             match: [] }, // via veiculo.cambio
  { key: "air_bag",     label: "AIR BAG",               match: ["Airbag motorista", "Airbag passageiro", "Airbag lateral", "Airbag de cortina"] },
  { key: "freios_abs",  label: "FREIOS ABS",            match: ["Freio ABS"] },
  { key: "retrov_elet", label: "RETROV. ELET.",          match: ["Retrovisores elétricos", "Retrovisores com rebatimento elétrico"] },
  { key: "som",         label: "SOM",                   match: ["Central multimídia", "Tela touch", "Bluetooth", "Som premium", "Entrada USB"] },
  // Coluna 3
  { key: "ar_digital",  label: "AR DIGITAL",            match: ["Ar condicionado dual zone"] },
  { key: "sensor_est",  label: "SEI. ESTACIONAMENTO",   match: ["Sensor de ré", "Sensor dianteiro", "Câmera de ré", "Câmera 360°"] },
  { key: "cont_som",    label: "CONT. SOM VOLANTE",     match: ["Volante multifuncional"] },
  { key: "piloto_aut",  label: "PILOTO AUTOMÁTICO",     match: ["Cruise control", "Cruise control adaptativo"] },
  { key: "teto_solar",  label: "TETO SOLAR",            match: ["Teto solar", "Teto panorâmico"] },
  { key: "limp_tras",   label: "LIMP. TRASEIRO.",        match: ["Limpador traseiro", "Desembaçador traseiro"] },
];

type TagKey = typeof TAG_ITENS[number]["key"];

interface TagData {
  ano: string;
  motor: string;
  combustivel: Record<"flex" | "gasolina" | "alcool" | "diesel", boolean>;
  itens: Record<string, boolean>;
  obs: string;
  preco: string;
}

export interface TagPatioModalProps {
  veiculo: any;
  onClose: () => void;
  logoUrl?: string;
  vitrineUrl?: string;
}

// Extrai um resumo curto do motor — ex: "1.0 76cv", "2.0 155cv"
function resumirMotor(motor: string): string {
  if (!motor) return "";

  // Cavalaria: primeiro número antes de "cv" ou "hp"
  const cvMatch = motor.match(/\b(\d+)\s*(?:cv|hp)\b/i);
  const cv = cvMatch ? `${cvMatch[1]}cv` : "";

  // Cilindrada: primeiro padrão X.X (ex: 1.0, 2.0, 1.6, 3.5)
  const cilMatch = motor.match(/\b(\d+[,.]\d+)\b/);
  const cil = cilMatch ? cilMatch[1].replace(",", ".") : "";

  // Formato limpo: "1.0 76cv" — usado quando temos os dois dados
  if (cil && cv) return `${cil} ${cv}`;
  if (cil) return cil;

  // Fallback: remove lixo verboso e retorna os primeiros tokens úteis + cv
  const clean = motor
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Motor|Total|de|em|válvulas?|valvulas?|High|Torque|Voyage|novo|antigo)\b/gi, "")
    .replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean).slice(0, 3).join(" ");
  return [clean, cv].filter(Boolean).join(" ").trim();
}

function buildInitialTag(veiculo: any): TagData {
  const opcionais: string[] = veiculo.opcionais ?? [];

  const matchAny = (termos: string[]) =>
    termos.some(t => opcionais.some(o => o.toLowerCase().includes(t.toLowerCase())));

  const comb = (veiculo.combustivel ?? "").toLowerCase();
  const cambio = (veiculo.cambio ?? "").toLowerCase();

  const itens: Record<string, boolean> = {};
  for (const item of TAG_ITENS) {
    let checked = matchAny(item.match);
    if (item.key === "camb_aut" && !checked) {
      checked = cambio.includes("automát") || cambio === "cvt";
    }
    itens[item.key] = checked;
  }

  const precoNum = veiculo.preco_sugerido ? veiculo.preco_sugerido / 100 : 0;
  const preco = precoNum
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0 }).format(precoNum)
    : "";

  return {
    ano: String(veiculo.ano_modelo ?? veiculo.ano ?? ""),
    motor: resumirMotor(veiculo.motor ?? ""),
    combustivel: {
      flex:     comb.includes("flex"),
      gasolina: comb.includes("gasolina"),
      alcool:   comb.includes("álcool") || comb.includes("alcool") || comb.includes("etanol"),
      diesel:   comb.includes("diesel"),
    },
    itens,
    obs: "",
    preco,
  };
}

// ── Checkbox reutilizável ────────────────────────────────────────────────────
function Caixa({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      className={`w-3.5 h-3.5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all cursor-pointer
        ${checked ? "bg-gray-900 border-gray-900" : "bg-white border-gray-400 hover:border-gray-700"}`}
    >
      {checked && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
          <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

// ── Nome completo do modelo (marca + modelo + versão + ano, sem duplicar versão) ─

// Verifica se a versão já está contida no modelo — por substring exato OU por
// sobreposição de tokens (≥60% das palavras ≥3 chars da versão aparecem no modelo).
// Necessário porque o banco armazena variações abreviadas:
//   modelo  = "HR-V LX 1.8 Flexone 16V 5p Aut."
//   versao  = "LX 1.8 Flexone Automática"  → 3/4 tokens batem → redundante
function versaoERedundante(modelo: string, versao: string): boolean {
  if (!versao) return false;
  const mLow = modelo.toLowerCase();
  const vLow = versao.toLowerCase();
  if (mLow.includes(vLow)) return true;
  const tokens = vLow.split(/\s+/).filter(w => w.length >= 3);
  if (tokens.length === 0) return true;
  const hits = tokens.filter(w => mLow.includes(w)).length;
  return hits / tokens.length >= 0.6;
}

function nomeCompletoModelo(veiculo: any): string {
  // Limpa marca: "VW - VolksWagen" → "VolksWagen", "GM - Chevrolet" → "Chevrolet"
  const marcaRaw = String(veiculo.marca ?? "").trim();
  const marca = marcaRaw.includes(" - ")
    ? marcaRaw.split(" - ").slice(1).join(" - ").trim()
    : marcaRaw;

  // Limpa modelo: remove "(novo)", "(antigo)" e similares
  const modeloRaw = String(veiculo.modelo ?? "").trim();
  const modelo = modeloRaw
    .replace(/\s*\((?:novo|antigo|old|new)\)\s*/gi, " ")
    .replace(/\s+/g, " ").trim();

  const versao = String(veiculo.versao ?? "").trim();
  const ano    = veiculo.ano_modelo ?? veiculo.ano ?? "";
  return [marca, modelo, versaoERedundante(modelo, versao) ? "" : versao, ano].filter(Boolean).join(" ");
}

// ── Geração do HTML da tag (layout único, reusado por impressão e PDF) ────────
// Layout fiel ao PDF de referência: logo topo → Modelo → tag → QR abaixo-centralizado.
// logoSrc/qrSrc já vêm resolvidos (URL pública ou data-URL) para reuso entre os fluxos.
function buildTagInnerHtml(
  tag: TagData,
  veiculo: any,
  logoSrc: string | undefined,
  qrSrc: string | undefined,
  orientacao: "retrato" | "paisagem",
): string {
  const L = orientacao === "paisagem";

  const maxWidth  = L ? "261mm" : "186mm";

  // Retrato: o conteúdo ocupa toda a folha A4 (wrapper flex column + tag flex:1)
  const wrapExtra = L ? "" : "min-height:272mm;display:flex;flex-direction:column;";
  const tagExtra  = L ? "" : "flex:1;display:flex;flex-direction:column;justify-content:space-between;";

  // Retrato usa 2 colunas (mais espaço por coluna) → fontes maiores, melhor leitura no pátio
  const f = {
    modelo: L ? 15 : 17,   // "Modelo:" acima da tag
    label:  L ? 15 : 18,   // ANO, MOTOR, OBS, R$ — labels
    val:    L ? 22 : 25,   // valores (ano, motor, R$)
    fuel:   L ? 15 : 18,   // FLEX / GASOLINA / ÁLCOOL / DIESEL
    item:   L ? 14 : 18,   // AR COND., B.COURO etc.
    qrTxt:  L ? 11 : 12,   // texto sob o QR
  };
  const cb  = L ? 15 : 18;      // checkbox px
  const imb = L ? 10 : 14;      // item margin-bottom
  const pad = L ? "16px 20px" : "20px 22px";
  const gap = L ? "30px"      : "28px";
  const dv  = L ? "10px"      : "13px";
  const mb  = L ? "14px"      : "16px";

  const sq = (on: boolean) =>
    `<span style="display:inline-block;width:${cb}px;height:${cb}px;border:2px solid #1a237e;border-radius:3px;margin-right:5px;background:${on ? "#1a237e" : "white"};vertical-align:middle;flex-shrink:0;"></span>`;

  const row = (item: typeof TAG_ITENS[number]) =>
    `<div style="display:flex;align-items:center;margin-bottom:${imb}px;">${sq(tag.itens[item.key])}<span style="font-size:${f.item}px;font-weight:700;font-family:Arial,sans-serif;color:#111;">${item.label}</span></div>`;

  // Retrato: 2 colunas (9 itens cada). Paisagem: 3 colunas (6 cada).
  const colunasHtml = L
    ? `<td style="vertical-align:top;width:33%;padding-right:10px;">${TAG_ITENS.slice(0, 6).map(row).join("")}</td>`
    + `<td style="vertical-align:top;width:33%;padding-right:10px;">${TAG_ITENS.slice(6, 12).map(row).join("")}</td>`
    + `<td style="vertical-align:top;width:34%;">${TAG_ITENS.slice(12, 18).map(row).join("")}</td>`
    : `<td style="vertical-align:top;width:50%;padding-right:20px;">${TAG_ITENS.slice(0, 9).map(row).join("")}</td>`
    + `<td style="vertical-align:top;width:50%;">${TAG_ITENS.slice(9, 18).map(row).join("")}</td>`;

  // Logo centralizado no topo
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" style="max-height:${L ? 80 : 120}px;max-width:${L ? 250 : 320}px;object-fit:contain;display:block;margin:0 auto;" />`
    : "";

  const nomeModelo = nomeCompletoModelo(veiculo);

  // QR code abaixo da tag — centralizado, maior no retrato
  const qrSize = L ? 110 : 160;
  const qrBlock = qrSrc ? `
  <div style="display:flex;justify-content:center;margin-top:${L ? 14 : 18}px;">
    <div style="text-align:center;">
      <img src="${qrSrc}" width="${qrSize}" height="${qrSize}" style="display:block;margin:0 auto;" />
      <p style="margin:8px auto 0;font-size:${f.qrTxt}px;font-weight:700;color:#555;font-family:Arial,sans-serif;text-align:center;">Acesse nosso site para ver todos os nossos carros.</p>
    </div>
  </div>` : "";

  return `<div style="width:100%;max-width:${maxWidth};margin:0 auto;font-family:Arial,sans-serif;${wrapExtra}">

  ${logoBlock ? `<!-- LOGO --><div style="text-align:center;margin-bottom:${L ? 10 : 8}px;">${logoBlock}</div>` : ""}

  <!-- MODELO -->
  <p style="text-align:center;font-size:${f.modelo}px;font-weight:700;color:#333;margin:0 0 ${mb};font-family:Arial,sans-serif;">Modelo: ${nomeModelo}</p>

  <!-- ══ TAG ══ -->
  <div style="border:2.5px solid #1a237e;border-radius:12px;padding:${pad};${tagExtra}">

    <!-- ANO / MOTOR -->
    <div style="display:flex;gap:${gap};margin-bottom:${mb};align-items:flex-end;">
      <div style="display:flex;align-items:flex-end;gap:8px;">
        <span style="font-size:${f.label}px;font-weight:900;text-transform:uppercase;white-space:nowrap;line-height:1;">ANO</span>
        <div style="border-bottom:1.5px solid #111;min-width:${L ? 100 : 80}px;padding-bottom:2px;font-size:${f.val}px;font-weight:700;line-height:1.4;">&nbsp;${tag.ano}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;flex:1;">
        <span style="font-size:${f.label}px;font-weight:900;text-transform:uppercase;white-space:nowrap;line-height:1;">MOTOR</span>
        <div style="border-bottom:1.5px solid #111;flex:1;padding-bottom:2px;font-size:${f.val}px;font-weight:700;line-height:1.4;">&nbsp;${tag.motor}</div>
      </div>
    </div>

    <!-- Combustível -->
    <div style="display:flex;gap:${L ? 22 : 16}px;margin-bottom:${mb};flex-wrap:wrap;align-items:center;">
      ${sq(tag.combustivel.flex)}<span    style="font-size:${f.fuel}px;font-weight:700;margin-right:${L ? 18 : 12}px;">FLEX</span>
      ${sq(tag.combustivel.gasolina)}<span style="font-size:${f.fuel}px;font-weight:700;margin-right:${L ? 18 : 12}px;">GASOLINA</span>
      ${sq(tag.combustivel.alcool)}<span  style="font-size:${f.fuel}px;font-weight:700;margin-right:${L ? 18 : 12}px;">ÁLCOOL</span>
      ${sq(tag.combustivel.diesel)}<span  style="font-size:${f.fuel}px;font-weight:700;">DIESEL</span>
    </div>

    <div style="border-top:1.5px solid #1a237e;margin:${dv} 0;"></div>

    <!-- Opcionais 3 colunas -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:${dv};">
      <tr>${colunasHtml}</tr>
    </table>

    <div style="border-top:1.5px solid #1a237e;margin:${dv} 0;"></div>

    <!-- OBS / R$ -->
    <div style="display:flex;gap:${gap};align-items:flex-end;">
      <div style="display:flex;align-items:flex-end;gap:8px;flex:1.5;">
        <span style="font-size:${f.label}px;font-weight:900;white-space:nowrap;line-height:1;">OBS,</span>
        <div style="border-bottom:1.5px solid #111;flex:1;padding-bottom:2px;font-size:${f.label}px;font-weight:600;line-height:1.4;">&nbsp;${tag.obs}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;flex:1;">
        <span style="font-size:${f.val}px;font-weight:900;white-space:nowrap;line-height:1;">R$</span>
        <div style="border-bottom:1.5px solid #111;flex:1;padding-bottom:2px;font-size:${f.val}px;font-weight:700;line-height:1.4;">&nbsp;${tag.preco}</div>
      </div>
    </div>
  </div>

  ${qrBlock}

</div>`;
}

// ── HTML completo para impressão via window.print (QR via api.qrserver.com) ───
function buildPrintHtml(
  tag: TagData,
  veiculo: any,
  logoUrl?: string,
  vitrineUrl?: string,
  orientacao: "retrato" | "paisagem" = "paisagem",
): string {
  const L = orientacao === "paisagem";
  const pageSize   = L ? "A4 landscape" : "A4 portrait";
  const pageMargin = L ? "10mm 18mm"    : "10mm 12mm";
  const qrSize     = L ? 110 : 160;

  // No fluxo de impressão o QR continua vindo do serviço externo: <img> cross-origin
  // renderiza em tela sem problema (só o canvas do PDF exigiria CORS).
  const qrSrc = vitrineUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize * 2}x${qrSize * 2}&data=${encodeURIComponent(vitrineUrl)}`
    : undefined;

  const inner = buildTagInnerHtml(tag, veiculo, logoUrl, qrSrc, orientacao);

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Tag Pátio — ${nomeCompletoModelo(veiculo)}</title>
<style>
  @page { size:${pageSize}; margin:${pageMargin}; }
  body  { margin:0; font-family:Arial,sans-serif; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head><body>
${inner}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};}</script>
</body></html>`;
}

// ── Componente principal ──────────────────────────────────────────────────────
export function TagPatioModal({ veiculo, onClose, logoUrl, vitrineUrl }: TagPatioModalProps) {
  const [tag, setTag] = useState<TagData>(() => buildInitialTag(veiculo));
  const [orientacao, setOrientacao] = useState<"retrato" | "paisagem">("retrato");
  const [gerando, setGerando] = useState(false);

  const toggleItem = (key: string) =>
    setTag(p => ({ ...p, itens: { ...p.itens, [key]: !p.itens[key] } }));

  const toggleComb = (key: keyof TagData["combustivel"]) =>
    setTag(p => ({ ...p, combustivel: { ...p.combustivel, [key]: !p.combustivel[key] } }));

  const handleImprimir = () => {
    const html = buildPrintHtml(tag, veiculo, logoUrl, vitrineUrl, orientacao);
    const isLandscape = orientacao === "paisagem";
    const win = window.open("", "_blank", isLandscape ? "width=1000,height=720" : "width=820,height=1060");
    if (!win) {
      alert("Permita pop-ups neste site para imprimir a tag.");
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  // Gera um PDF A4 limpo (sem o cabeçalho/rodapé que o navegador injeta no
  // window.print) renderizando o MESMO layout da impressão num container offscreen
  // → html2canvas → jsPDF. O QR é gerado localmente e o logo vira data-URL para
  // evitar canvas "tainted" por imagem cross-origin. Deps carregadas sob demanda.
  const handleBaixarPdf = async () => {
    if (gerando) return;
    setGerando(true);
    let holder: HTMLDivElement | null = null;
    try {
      const [{ default: html2canvas }, { jsPDF }, QRCode] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
        import("qrcode"),
      ]);

      // QR local — não depende de serviço externo na hora de gerar o PDF
      let qrSrc: string | undefined;
      if (vitrineUrl) {
        qrSrc = await QRCode.toDataURL(vitrineUrl, { width: 600, margin: 1 });
      }

      // Logo → data-URL (evita tainting); cai pra URL crua se o fetch falhar
      let logoSrc = logoUrl;
      if (logoUrl) {
        try {
          const resp = await fetch(logoUrl, { mode: "cors" });
          const blob = await resp.blob();
          logoSrc = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("logo read failed"));
            fr.readAsDataURL(blob);
          });
        } catch {
          logoSrc = logoUrl; // html2canvas ainda tenta via useCORS
        }
      }

      const L = orientacao === "paisagem";
      const contentWmm = L ? 261 : 186; // área útil A4 menos as margens do layout

      holder = document.createElement("div");
      holder.style.position = "fixed";
      holder.style.left = "-10000px";
      holder.style.top = "0";
      holder.style.width = `${contentWmm}mm`;
      holder.style.background = "#ffffff";
      holder.innerHTML = buildTagInnerHtml(tag, veiculo, logoSrc, qrSrc, orientacao);
      document.body.appendChild(holder);

      const canvas = await html2canvas(holder, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const doc = new jsPDF({ orientation: L ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const marginX = L ? 18 : 12;
      const marginY = 10;
      const availW = pageW - marginX * 2;
      const availH = pageH - marginY * 2;

      // encaixa a imagem na área útil preservando o aspect ratio
      const ratio = canvas.height / canvas.width;
      let imgW = availW;
      let imgH = imgW * ratio;
      if (imgH > availH) { imgH = availH; imgW = imgH / ratio; }
      const x = (pageW - imgW) / 2;

      doc.addImage(canvas.toDataURL("image/png"), "PNG", x, marginY, imgW, imgH);

      const slug =
        nomeCompletoModelo(veiculo)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "tag";
      doc.save(`tag-${slug}.pdf`);
    } catch (e) {
      console.error("Erro ao gerar PDF da tag:", e);
      alert("Não foi possível gerar o PDF. Tente novamente ou use Imprimir.");
    } finally {
      if (holder) document.body.removeChild(holder);
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gray-900 flex items-center justify-center">
              <Tag size={15} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">Tag Pátio</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                {veiculo.marca} {veiculo.modelo} {veiculo.ano_modelo ?? veiculo.ano} — edite e imprima
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <X size={14} className="text-gray-600" />
          </button>
        </div>

        {/* Corpo — preview editável */}
        <div className="overflow-y-auto flex-1 px-8 py-6">

          {/* Toggle orientação */}
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Orientação:</span>
            <div className="flex gap-1.5">
              {(["paisagem", "retrato"] as const).map(o => (
                <button
                  key={o}
                  onClick={() => setOrientacao(o)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all
                    ${orientacao === o
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                >
                  {o === "paisagem" ? "↔ Paisagem" : "↕ Retrato"}
                </button>
              ))}
            </div>
          </div>

          <div className="border-2 border-blue-900 rounded-2xl p-5 space-y-4">

            {/* ANO + MOTOR */}
            <div className="flex gap-4">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-800 shrink-0">ANO</span>
                <input
                  value={tag.ano}
                  onChange={e => setTag(p => ({ ...p, ano: e.target.value }))}
                  className="flex-1 border-b-2 border-gray-200 focus:border-gray-900 outline-none text-sm font-bold text-gray-900 pb-0.5 bg-transparent transition-colors"
                />
              </div>
              <div className="flex items-center gap-2 flex-[2]">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-800 shrink-0">MOTOR</span>
                <input
                  value={tag.motor}
                  onChange={e => setTag(p => ({ ...p, motor: e.target.value }))}
                  className="flex-1 min-w-0 border-b-2 border-gray-200 focus:border-gray-900 outline-none text-sm font-bold text-gray-900 pb-0.5 bg-transparent transition-colors"
                />
              </div>
            </div>

            {/* Combustível */}
            <div className="flex gap-5 flex-wrap">
              {(["flex", "gasolina", "alcool", "diesel"] as const).map((c, i) => (
                <label key={c} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Caixa checked={tag.combustivel[c]} onChange={() => toggleComb(c)} />
                  <span className="text-[10px] font-black uppercase tracking-wide text-gray-700">
                    {["FLEX", "GASOLINA", "ÁLCOOL", "DIESEL"][i]}
                  </span>
                </label>
              ))}
            </div>

            <div className="border-t border-gray-200" />

            {/* Opcionais — 2 colunas (retrato) ou 3 (paisagem), espelhando a impressão */}
            <div className={`grid gap-x-4 gap-y-0 ${orientacao === "retrato" ? "grid-cols-2" : "grid-cols-3"}`}>
              {(orientacao === "retrato"
                ? [TAG_ITENS.slice(0, 9), TAG_ITENS.slice(9, 18)]
                : [TAG_ITENS.slice(0, 6), TAG_ITENS.slice(6, 12), TAG_ITENS.slice(12, 18)]
              ).map((coluna, ci) => (
                <div key={ci} className="space-y-2">
                  {coluna.map(item => (
                    <label key={item.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <Caixa checked={!!tag.itens[item.key]} onChange={() => toggleItem(item.key)} />
                      <span className={`font-black uppercase tracking-wide text-gray-700 leading-tight ${orientacao === "retrato" ? "text-[11px]" : "text-[9px]"}`}>{item.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200" />

            {/* OBS + R$ */}
            <div className="flex gap-4">
              <div className="flex items-center gap-2 flex-[1.5]">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-800 shrink-0">OBS,</span>
                <input
                  value={tag.obs}
                  onChange={e => setTag(p => ({ ...p, obs: e.target.value }))}
                  placeholder="—"
                  className="flex-1 border-b-2 border-gray-200 focus:border-gray-900 outline-none text-sm font-bold text-gray-900 pb-0.5 bg-transparent transition-colors placeholder-gray-300"
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[11px] font-black uppercase tracking-widest text-gray-800 shrink-0">R$</span>
                <input
                  value={tag.preco}
                  onChange={e => setTag(p => ({ ...p, preco: e.target.value }))}
                  placeholder="0"
                  className="flex-1 border-b-2 border-gray-200 focus:border-gray-900 outline-none text-sm font-bold text-gray-900 pb-0.5 bg-transparent transition-colors placeholder-gray-300"
                />
              </div>
            </div>
          </div>

          <p className="mt-3 text-[10px] text-gray-400 font-bold text-center uppercase tracking-widest">
            Clique em qualquer campo para editar antes de imprimir
          </p>

          {/* Preview: logo topo + QR abaixo-direita */}
          {(logoUrl || vitrineUrl) && (
            <div className="mt-4 space-y-2">
              {logoUrl && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="Logo" className="h-10 max-w-[160px] object-contain" />
                </div>
              )}
              {vitrineUrl && (
                <div className="flex justify-end items-center gap-2">
                  <p className="text-[9px] text-gray-400 font-bold text-right leading-snug">
                    Acesse nosso site para<br />ver todos os nossos carros.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(vitrineUrl)}`}
                    alt="QR Code vitrine"
                    className="w-12 h-12 flex-shrink-0"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 transition-colors"
          >
            Fechar
          </button>
          <button
            onClick={handleImprimir}
            className="px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors flex items-center gap-2"
          >
            <Printer size={13} /> Imprimir
          </button>
          <button
            onClick={handleBaixarPdf}
            disabled={gerando}
            className="px-6 py-2.5 bg-gray-900 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors flex items-center gap-2"
          >
            {gerando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {gerando ? "Gerando…" : "Baixar PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
