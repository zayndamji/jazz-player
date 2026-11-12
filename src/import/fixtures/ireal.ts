import { PREFIX, swapBlock } from "../ireal";

/** A song as the plain, readable chord string and the fields iReal Pro keeps beside it. Made up, not real tunes. */
export interface PlainSong {
  title: string;
  composer?: string;
  style: string;
  key: string;
  tempo?: number;
  music: string;
}

/** Scramble a plain chord string the way iReal Pro does, so fixtures can stay readable. */
export function scramble(plain: string): string {
  let out = "";
  let rest = plain;
  while (rest.length > 50) {
    const block = rest.slice(0, 50);
    rest = rest.slice(50);
    out += rest.length < 2 ? block : swapBlock(block);
  }
  return out + rest;
}

/** An irealb:// link holding these songs (a playlist when a name is given). */
export function irealLink(songs: PlainSong[], playlist?: string): string {
  const text = songs
    .map((s) => [s.title, s.composer ?? "Nobody", "", s.style, s.key, "", PREFIX + scramble(s.music), "", s.tempo ?? 0, 0].join("="))
    .join("===");
  return "irealb://" + encodeURIComponent(playlist ? `${text}===${playlist}` : text);
}

/** The older unscrambled link form. */
export function irealBookLink(songs: PlainSong[], playlist?: string): string {
  const text = songs.map((s) => [s.title, s.composer ?? "Nobody", s.style, s.key, "n", s.music].join("=")).join("===");
  return "irealbook://" + (playlist ? `${text}===${playlist}` : text);
}

export const swingSong: PlainSong = {
  title: "Made Up Swing",
  style: "Medium Swing",
  key: "F",
  tempo: 150,
  music: "[T44*iG-7 ,C7 |G-7 ,C7 ]*A{F^7 |D-7 ,G7 |N1C-7 ,F7 }N2Bb^7 ,Eh7 A7alt |F^7 ]*BD-7 |G7sus |C^7 |x |Dh7 ,G7b9 Z",
};

export const bossaSong: PlainSong = {
  title: "Made Up Bossa",
  style: "Bossa Nova",
  key: "A-",
  tempo: 120,
  music: "[T44*AA-7 |D-7 |Bh7 ,E7#9 |A-^7 ,A-7 |*BF^7 |E7 |A-7 |Kcl|Z",
};

export const waltzSong: PlainSong = {
  title: "Made Up Waltz",
  style: "Jazz Waltz",
  key: "G",
  music: "[T34*AG^7 |E-7 ,A7 |D-7 |G7 ]*BC^7 |Co7 |G^7/B |Bb7 ,D7alt Z",
};
