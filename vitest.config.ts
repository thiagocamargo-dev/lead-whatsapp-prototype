import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite não está na lista `builtinModules` do Node (só é acessível com o prefixo
    // "node:"), então o resolvedor do Vite tenta tratá-lo como um pacote comum e falha.
    // Forçamos a externalização para que o import nativo do Node seja usado sem transformação.
    server: {
      deps: {
        external: [/node:sqlite/, /^sqlite$/],
      },
    },
  },
});
