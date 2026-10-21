// lib/cpf.ts — validação de CPF por dígito verificador. Pura: roda no
// servidor e no navegador (a página /financiamento avisa antes de gastar
// uma consulta; a CredPro não valida o DV e o portal do banco trava).

export function cpfValido(d: string): boolean {
  d = String(d ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}
