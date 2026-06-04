"use client";

import React, { useState } from "react";
import { X, Printer, Tag } from "lucide-react";

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
    motor: veiculo.motor ?? "",
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

// ── Geração do HTML para impressão — A4 retrato ───────────────────────────────
function buildPrintHtml(tag: TagData, veiculo: any, logoUrl?: string, vitrineUrl?: string): string {
  const sq = (checked: boolean) =>
    `<span style="display:inline-block;width:11px;height:11px;border:1.5px solid #1a237e;border-radius:2px;margin-right:4px;background:${checked ? "#1a237e" : "white"};vertical-align:middle;flex-shrink:0;"></span>`;

  const itemRow = (item: typeof TAG_ITENS[number]) =>
    `<div style="display:flex;align-items:center;margin-bottom:6px;">${sq(tag.itens[item.key])}<span style="font-size:10px;font-weight:700;font-family:Arial,sans-serif;color:#111;">${item.label}</span></div>`;

  const col1 = TAG_ITENS.slice(0, 6).map(itemRow).join("");
  const col2 = TAG_ITENS.slice(6, 12).map(itemRow).join("");
  const col3 = TAG_ITENS.slice(12, 18).map(itemRow).join("");

  // QR code via qrserver.com (já usado no projeto para PIX)
  const qrSize = 90;
  const qrImg = vitrineUrl
    ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=${qrSize * 2}x${qrSize * 2}&data=${encodeURIComponent(vitrineUrl)}" width="${qrSize}" height="${qrSize}" style="display:block;" />`
    : "";

  const logoImg = logoUrl
    ? `<img src="${logoUrl}" style="max-height:50px;max-width:140px;object-fit:contain;display:block;" />`
    : `<span style="font-size:14px;font-weight:900;font-family:Arial,sans-serif;color:#111;">AutoZap</span>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<style>
  @page { size: A4 portrait; margin: 12mm 14mm; }
  body { margin:0; font-family:Arial,sans-serif; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head><body>
<div style="width:100%;max-width:182mm;margin:0 auto;font-family:Arial,sans-serif;">

  <!-- ══ TAG (seção branca com borda azul) ══ -->
  <div style="border:2.5px solid #1a237e;border-radius:12px;padding:14px 16px;margin-bottom:12px;">

    <!-- ANO / MOTOR -->
    <div style="display:flex;gap:24px;margin-bottom:10px;align-items:flex-end;">
      <div style="display:flex;align-items:flex-end;gap:6px;">
        <span style="font-size:12px;font-weight:900;text-transform:uppercase;white-space:nowrap;line-height:1;">ANO</span>
        <div style="border-bottom:1.5px solid #111;min-width:80px;padding-bottom:1px;font-size:14px;font-weight:700;line-height:1.5;">&nbsp;${tag.ano}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;">
        <span style="font-size:12px;font-weight:900;text-transform:uppercase;white-space:nowrap;line-height:1;">MOTOR</span>
        <div style="border-bottom:1.5px solid #111;min-width:80px;padding-bottom:1px;font-size:14px;font-weight:700;line-height:1.5;">&nbsp;${tag.motor}</div>
      </div>
    </div>

    <!-- Combustível -->
    <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
      ${sq(tag.combustivel.flex)}<span style="font-size:11px;font-weight:700;margin-right:12px;">FLEX</span>
      ${sq(tag.combustivel.gasolina)}<span style="font-size:11px;font-weight:700;margin-right:12px;">GASOLINA</span>
      ${sq(tag.combustivel.alcool)}<span style="font-size:11px;font-weight:700;margin-right:12px;">ÁLCOOL</span>
      ${sq(tag.combustivel.diesel)}<span style="font-size:11px;font-weight:700;">DIESEL</span>
    </div>

    <div style="border-top:1.5px solid #1a237e;margin:8px 0;"></div>

    <!-- Opcionais 3 colunas -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <tr>
        <td style="vertical-align:top;width:33%;padding-right:6px;">${col1}</td>
        <td style="vertical-align:top;width:33%;padding-right:6px;">${col2}</td>
        <td style="vertical-align:top;width:34%;">${col3}</td>
      </tr>
    </table>

    <div style="border-top:1.5px solid #1a237e;margin:8px 0;"></div>

    <!-- OBS / R$ -->
    <div style="display:flex;gap:20px;align-items:flex-end;">
      <div style="display:flex;align-items:flex-end;gap:6px;flex:1.5;">
        <span style="font-size:12px;font-weight:900;white-space:nowrap;line-height:1;">OBS,</span>
        <div style="border-bottom:1.5px solid #111;flex:1;padding-bottom:1px;font-size:12px;font-weight:600;line-height:1.5;">&nbsp;${tag.obs}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;flex:1;">
        <span style="font-size:14px;font-weight:900;white-space:nowrap;line-height:1;">R$</span>
        <div style="border-bottom:1.5px solid #111;flex:1;padding-bottom:1px;font-size:14px;font-weight:700;line-height:1.5;">&nbsp;${tag.preco}</div>
      </div>
    </div>
  </div>

  <!-- ══ RODAPÉ DA LOJA (logo + QR code) ══ -->
  <div style="background:#e8e8e6;border-radius:12px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
    <!-- Esquerda: logo + texto -->
    <div style="display:flex;align-items:center;gap:14px;flex:1;">
      ${logoImg}
      ${vitrineUrl ? `<div>
        <p style="margin:0 0 3px;font-size:9px;font-weight:700;color:#555;font-family:Arial,sans-serif;">aponte a câmera do celular para o QR Code</p>
        <p style="margin:0;font-size:9px;font-weight:700;color:#555;font-family:Arial,sans-serif;">e veja este veículo na vitrine online</p>
      </div>` : ""}
    </div>
    <!-- Direita: QR code -->
    ${qrImg}
  </div>

</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};}</script>
</body></html>`;
}

// ── Componente principal ──────────────────────────────────────────────────────
export function TagPatioModal({ veiculo, onClose, logoUrl, vitrineUrl }: TagPatioModalProps) {
  const [tag, setTag] = useState<TagData>(() => buildInitialTag(veiculo));

  const toggleItem = (key: string) =>
    setTag(p => ({ ...p, itens: { ...p.itens, [key]: !p.itens[key] } }));

  const toggleComb = (key: keyof TagData["combustivel"]) =>
    setTag(p => ({ ...p, combustivel: { ...p.combustivel, [key]: !p.combustivel[key] } }));

  const handleImprimir = () => {
    const html = buildPrintHtml(tag, veiculo, logoUrl, vitrineUrl);
    const win = window.open("", "_blank", "width=820,height=900");
    if (!win) {
      alert("Permita pop-ups neste site para imprimir a tag.");
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl flex flex-col max-h-[92vh]">

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
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-800 shrink-0">MOTOR</span>
                <input
                  value={tag.motor}
                  onChange={e => setTag(p => ({ ...p, motor: e.target.value }))}
                  className="flex-1 border-b-2 border-gray-200 focus:border-gray-900 outline-none text-sm font-bold text-gray-900 pb-0.5 bg-transparent transition-colors"
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

            {/* Opcionais — 3 colunas */}
            <div className="grid grid-cols-3 gap-x-3 gap-y-0">
              <div className="space-y-2">
                {TAG_ITENS.slice(0, 6).map(item => (
                  <label key={item.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Caixa checked={!!tag.itens[item.key]} onChange={() => toggleItem(item.key)} />
                    <span className="text-[9px] font-black uppercase tracking-wide text-gray-700 leading-tight">{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                {TAG_ITENS.slice(6, 12).map(item => (
                  <label key={item.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Caixa checked={!!tag.itens[item.key]} onChange={() => toggleItem(item.key)} />
                    <span className="text-[9px] font-black uppercase tracking-wide text-gray-700 leading-tight">{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                {TAG_ITENS.slice(12, 18).map(item => (
                  <label key={item.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Caixa checked={!!tag.itens[item.key]} onChange={() => toggleItem(item.key)} />
                    <span className="text-[9px] font-black uppercase tracking-wide text-gray-700 leading-tight">{item.label}</span>
                  </label>
                ))}
              </div>
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

          {/* Preview do rodapé — logo + QR code */}
          {(logoUrl || vitrineUrl) && (
            <div className="mt-4 bg-gray-100 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={logoUrl} alt="Logo" className="h-10 max-w-[100px] object-contain flex-shrink-0" />
                )}
                {vitrineUrl && (
                  <p className="text-[9px] text-gray-500 font-bold leading-snug">
                    aponte a câmera para o QR Code<br />e veja na vitrine online
                  </p>
                )}
              </div>
              {vitrineUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(vitrineUrl)}`}
                  alt="QR Code vitrine"
                  className="w-14 h-14 flex-shrink-0"
                />
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
            className="px-6 py-2.5 bg-gray-900 hover:bg-red-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors flex items-center gap-2"
          >
            <Printer size={13} /> Imprimir Tag
          </button>
        </div>
      </div>
    </div>
  );
}
