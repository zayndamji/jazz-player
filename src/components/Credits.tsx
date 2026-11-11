const LIBRARIES = [
  { name: "Tone.js", url: "https://github.com/Tonejs/Tone.js", license: "MIT", use: "audio scheduling and synthesis" },
  { name: "tonal", url: "https://github.com/tonaljs/tonal", license: "MIT", use: "chord symbol parsing" },
  { name: "React", url: "https://github.com/facebook/react", license: "MIT", use: "interface" },
  { name: "Vite", url: "https://github.com/vitejs/vite", license: "MIT", use: "build tool" },
];

export function Credits() {
  return (
    <footer className="credits">
      <h2>Credits</h2>
      <p>
        Piano: <a href="https://archive.org/details/SalamanderGrandPianoV3">Salamander Grand Piano V3</a> by Alexander Holm,{" "}
        <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>, as rendered by the Tone.js project. Bass: acoustic bass
        from the Fluid (R3) GM SoundFont by Frank Wen, MIT License, as rendered by{" "}
        <a href="https://github.com/gleitz/midi-js-soundfonts">midi-js-soundfonts</a>. Drums and click are synthesized.
      </p>
      <p>
        Built with{" "}
        {LIBRARIES.map((lib, i) => (
          <span key={lib.name}>
            <a href={lib.url}>{lib.name}</a> ({lib.license}, {lib.use}){i < LIBRARIES.length - 1 ? ", " : "."}
          </span>
        ))}
      </p>
    </footer>
  );
}
