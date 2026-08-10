# Third-Party Notices

epJSON Viewer is licensed under the [Apache License 2.0](LICENSE). The built
distribution (`dist/`, and the GitHub Pages deployment produced from it) bundles
the third-party components listed below, each under its own license. Nothing
here restricts your use of epJSON Viewer itself; these notices are reproduced to
satisfy the attribution terms of the bundled components.

## Bundled software

| Component | Version | License |
| --- | --- | --- |
| [three.js](https://threejs.org/) | 0.185.1 | MIT |
| [Vue](https://vuejs.org/) (incl. `@vue/*` runtime packages) | 3.5.40 | MIT |
| [Pinia](https://pinia.vuejs.org/) | 4.0.2 | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | 4.3.3 | MIT |
| [earcut](https://github.com/mapbox/earcut) | 3.2.3 | ISC |
| [Lucide](https://lucide.dev/) (`lucide-vue-next`) | 1.0.0 | ISC |

The MIT and ISC licenses each require that their copyright notice and permission
notice be included in distributions. Full texts are available in each package's
own `LICENSE` file under `node_modules/`, and at the project links above.

## Bundled fonts

The build emits font files (`dist/assets/*.woff2`, `dist/assets/*.woff`) for the two typefaces below.
Both are licensed under the **SIL Open Font License, Version 1.1**, whose full
text is included in this repository:

| Font | Copyright | License text |
| --- | --- | --- |
| [Inter](https://github.com/rsms/inter) | Copyright 2016 The Inter Project Authors | [licenses/OFL-1.1-Inter.txt](licenses/OFL-1.1-Inter.txt) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Copyright 2020 The JetBrains Mono Project Authors | [licenses/OFL-1.1-JetBrainsMono.txt](licenses/OFL-1.1-JetBrainsMono.txt) |

Fonts are delivered via the [Fontsource](https://fontsource.org/) packages
`@fontsource-variable/inter` and `@fontsource/jetbrains-mono` (see
`src/style.css`). Under the OFL, the fonts are redistributed here unmodified and
bundled with the software; the license text above must accompany any further
redistribution of the font files.

## Regenerating this list

Licenses were read from the installed packages:

```sh
node -e "const j=require('./node_modules/<pkg>/package.json'); console.log(j.name, j.version, j.license)"
```

Re-check this file whenever runtime dependencies in `package.json` change.
