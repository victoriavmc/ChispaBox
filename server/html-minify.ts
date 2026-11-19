import type { Plugin } from 'vite';

// Compacta el HTML de salida (solo en `build`): quita la sangría y las líneas vacías del marcado.
// No cambia cómo se ve la página: en HTML un salto de línea y una sangría valen lo mismo que un espacio,
// y las líneas vacías no se pintan. Los bloques donde el espacio sí importa se dejan intactos.

const PROTEGIDOS = /<(pre|textarea|script|style)\b[\s\S]*?<\/\1\s*>/gi;

export function compactarHtml(html: string): string {
  const guardados: string[] = [];
  const marcador = (i: number) => `\u0000${i}\u0000`;
  const sinBloques = html.replace(PROTEGIDOS, (bloque) => {
    guardados.push(bloque);
    return marcador(guardados.length - 1);
  });
  const compacto = sinBloques
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n\s*\n/g, '\n');
  return compacto.replace(/\u0000(\d+)\u0000/g, (_, i: string) => guardados[Number(i)]);
}

export function minificarHtml(): Plugin {
  return {
    name: 'html-minify',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => compactarHtml(html),
    },
  };
}
