// catalog.mjs — the fictional library. Nothing here is real music; it exists so the
// KourOS glass can be judged against a library that has the SHAPE of a real one:
// long titles beside short ones, diacritics, a compilation, a two-disc set, an EP,
// a single, sixty years of release dates and every genre the Home rails key off.
//
// The compact string form is deliberate. A hand-written 270-title catalog is what
// makes a design review read as "an app" rather than "lorem ipsum in a grid", and
// one line per album is the only way to keep that much prose legible.
//
//   album:  'Title|year|genre|artStyle|Track / Track / Track'
//   discs:  a '~' inside the track list starts disc 2.
//
// `sound` (per ARTIST) picks the synthesis profile in audio.mjs and the descriptor
// centre in embedder.mjs, so what a track SOUNDS like, where it sits on the vibe
// map and which time-of-day rail claims it all come from one word.

/** Every artist, with the sound profile its records are cut from. */
export const ARTISTS = [
  { name: 'Vesper Lane',          sound: 'shoegaze',   albums: [
    'Sølvregn|2019|Shoegaze; Dream Pop|rings|Sølvregn / Cold Frame / Nightjar (feat. Marguerite Sol) / Halo, Halving / Weather for Leaving / A Room That Faces North / Sølvregn (Reprise)',
    'STATIC BLOOM|2022|Shoegaze; Alternative|bloom|Static Bloom / Pale Machine / Ninety Miles of Fence / Amaranth / The Undertow Is Not a Metaphor / Glasswing / Dial Tone / Static Bloom (Slow)',
  ] },
  { name: 'Hollow Coast',         sound: 'postrock',   albums: [
    'A Long Way Down From the Only Window That Ever Faced the Sea|2016|Post-Rock; Instrumental|horizon|Ballast / The Long Way Down / Signal Fires / Anchorage / Every Harbour Empties / The Only Window / Low Tide, Later',
    '…and then the tide|2021|Post-Rock; Ambient|wash|Preamble / …and then the tide / Cartography / The Slow Collapse of Weather / Foghorn / Undersong / Return to the Shipping Lanes / Coda for an Empty Pier',
  ] },
  { name: 'The Ardent Few',       sound: 'indie',      albums: [
    'Paper Radio|2011|Indie; Alternative|stripes|Paper Radio / Motor Pool / Sweetheart Frequency / Wire and Wool / The Nineties Called / Bright Idea / Sixteen Streetlights / Everything Louder / Paper Radio (Acoustic)',
    'Municipal Gold|2014|Indie; Rock|grid|Municipal Gold / Civic Duty / The Parking Structure / Half of Ohio / Careful With That / Tuesday, Probably / Loud Enough to Leave / Municipal Silver',
    'Runner|2018|Indie; Pop|burst|Runner / Kerosene Sunday / Second Language / Bad at Distances / Runner (Reprise) / The Fast Part / Down the Whole Coast / Nothing Rhymes With Orange / Last Call at the Laundromat / Runner (Instrumental)',
  ] },
  { name: 'Marguerite Sol',       sound: 'folk',       albums: [
    'Wintering|2009|Folk; Acoustic|split|Wintering / Bone China / The Orchard Road / Salt / Six Weeks of Rain / My Mother\'s Coat / Wintering (Alternate)',
    'Café Électrique|2013|Folk; Jazz|halo|Café Électrique / Rue Sans Nom / Little Wire / The Long Apology / Paper Boats / Half a Franc / Closing Time',
    'The Quiet Part|2020|Folk; Acoustic|split|The Quiet Part / Out Loud / Kestrel / Handwriting / A Field Is Not a Metaphor Either / Sundowning / Threadbare / The Quiet Part (Live)',
  ] },
  { name: 'Kite & Anvil',         sound: 'alt',        albums: [
    'Ironwork|2007|Alternative; Rock|grid|Ironwork / Ballpeen / Cold Rivet / The Foundry Floor / Slag / Tempering / Quench / Ironwork (Reprise)',
    'Halcyon — Live at the Foundry|2010|Alternative; Rock|burst|Ironwork (Live) / Cold Rivet (Live) / Slag (Live) / Halcyon (Live) / The Foundry Floor (Live) / Quench (Live)',
  ] },
  { name: 'NULLSET',              sound: 'electronic', albums: [
    'Machine Language|2015|Electronic; Techno|grid|Boot Sector / Machine Language / Null Pointer / Handshake / Race Condition / Deadlock / Garbage Collector / Cold Boot / Machine Language (Extended)',
    'Cold Storage|2019|Electronic; Ambient|wash|Cold Storage / Write Barrier / Spinning Rust / Checksum / Silent Corruption / Parity / Rebuild / The Array Is Degraded / Restore Point',
    'IV|2024|Electronic; Techno|bloom|One / Two / Three / Four / Five / Six',
  ] },
  { name: 'Ilse Brandt',          sound: 'ambient',    albums: [
    'Room Tone|2017|Ambient; Instrumental|wash|Room Tone I / Room Tone II / Hum / Röntgen / The Air Handler / Room Tone III / Standing Wave / Room Tone IV',
    'Slow Weather|2023|Ambient; Downtempo|horizon|Barometer / Slow Weather / Cirrus / A Pressure System Named For Someone\'s Aunt / Petrichor / Nimbus / Slow Weather (Night)',
  ] },
  { name: 'Saffron Teeth',        sound: 'punk',       albums: [
    'Chew|2005|Punk; Alternative|stripes|Chew / Landlord / Nine Volt / Bite Down / Public Transit / Nothing Doing / Sorry Not / Chew Again / Encore, Regrettably / Exit Music for a Van',
    'Molar|2008|Punk; Rock|burst|Molar / Wisdom / Cavity / Fluoride / The Dentist Is a Cop / Rinse / Spit / Molar (Live at the Squat)',
  ] },
  { name: 'Orchid Machine',       sound: 'downtempo',  albums: [
    'Glasshouse|2012|Downtempo; Electronic|halo|Glasshouse / Fern / Humidity / Potting Shed / The Gardener Sleeps / Orchid / Condensation / Glasshouse (Dub)',
    'Nocturne Gardens|2021|Downtempo; Ambient|rings|Nocturne / Moonflower / The Gardens After Hours / Evening Primrose / Sleepwalk / Dew / Nocturne (Reprise)',
  ] },
  { name: 'Duo Karénine',         sound: 'classical',  albums: [
    'Nocturnes & Études|1994|Classical; Instrumental|split|Nocturne in E-flat / Étude No. 1 / Étude No. 2 / Nocturne in C minor / Étude No. 3 / Berceuse / Étude No. 4 / Nocturne in B',
    'The Winter Sonatas|2002|Classical; Instrumental|horizon|Sonata No. 1: Allegro / Sonata No. 1: Adagio / Sonata No. 1: Rondo / Sonata No. 2: Largo / Sonata No. 2: Presto / Sonata No. 3: Andante / Sonata No. 3: Finale',
  ] },
  { name: 'Bell Foundry Quartet', sound: 'jazz',       albums: [
    'Blue Annex|1968|Jazz|halo|Blue Annex / Sidecar / The Long Take / Brass Tacks / Nightporter / Blue Annex (Take 4)',
    'Second Shift|1971|Jazz; Instrumental|stripes|Second Shift / Clocking Out / Sixteen Bars of Nothing / The Foreman / Union Dues / Overtime / Last Bus',
    'Complete Sessions 1968–1974|1998|Jazz|grid|Blue Annex / Sidecar / The Long Take / Brass Tacks / Nightporter / Second Shift / Clocking Out ~ The Foreman / Union Dues / Overtime / Last Bus / Blue Annex (Alternate Take) / Sidecar (False Start) / Nightporter (Extended)',
  ] },
  { name: 'Grey Harbour',         sound: 'metal',      albums: [
    'Drowning Bell|2013|Metal; Alternative|bloom|Drowning Bell / Keelhaul / The Wreck of the Something Something / Iron Gospel / Barnacle / Salt Damage / Drowning Bell (Reprise)',
    'Leviathan Hymns|2018|Metal|burst|Leviathan / Hymn for a Dead Engine / Sixty Fathoms / The Pressure Hull / Cathedral of Rust / Sonar / Leviathan (Coda)',
  ] },
  { name: 'Postal Sons',          sound: 'americana',  albums: [
    'Route Nine|1998|Americana; Folk|horizon|Route Nine / Diner Coffee / The Long Haul / Weigh Station / Radio Static, Kansas / Motel Ceiling / Home by Thursday',
    'Dead Letter Office|2004|Americana; Acoustic|split|Dead Letter / Return to Sender / The Mailman\'s Daughter / Zip Code / Certified / Postmark / Dead Letter (Reprise) / Undeliverable',
  ] },
  { name: 'Rowan Meade',          sound: 'pop',        albums: [
    'Little Fires|2020|Pop; Indie|bloom|Little Fires / Matchbook / Kindling / Smoke Alarm / The Whole Block / Ash Wednesday / Little Fires (Acoustic) / Firebreak / Embers',
    'Telephone Weather|2025|Pop; Alternative|burst|Telephone Weather / Voicemail / Long Distance / Dial Tone / Area Code / Hold Music / Disconnect / Telephone Weather (Reprise) / Redial',
    'Kindling|2021|Pop|rings|Kindling (Single Edit)',
  ] },
];

/** The compilation — its own entry because `albumartist` differs from `artist`
 *  on every track, which is the one metadata shape the browse grid groups by. */
export const COMPILATION = {
  albumartist: 'Various Artists',
  title: 'Neon Tide, Vol. 3',
  year: 2023,
  genre: 'Electronic; Downtempo',
  art: 'rings',
  sound: 'electronic',
  tracks: [
    ['NULLSET',        'Cold Boot (Tide Mix)'],
    ['Orchid Machine', 'Humidity (Extended)'],
    ['Vesper Lane',    'Glasswing (NULLSET Rework)'],
    ['Ilse Brandt',    'Cirrus at Speed'],
    ['Rowan Meade',    'Dial Tone (Club Edit)'],
    ['Orchid Machine', 'Dew (Late Version)'],
    ['NULLSET',        'Parity (Reprise)'],
    ['Ilse Brandt',    'The Air Handler (Rework)'],
  ],
};

/** Parse the compact album strings into flat album records. */
export function buildCatalog() {
  const albums = [];
  for (const artist of ARTISTS) {
    for (const line of artist.albums) {
      const [title, year, genre, art, trackBlock] = line.split('|');
      const discs = trackBlock.split('~').map((d) => d.split('/').map((s) => s.trim()).filter(Boolean));
      albums.push({
        artist: artist.name,
        albumartist: artist.name,
        title, year: Number(year), genre, art,
        sound: artist.sound,
        discs,
        tracks: discs.flatMap((d, di) =>
          d.map((t, ti) => ({ title: t, artist: artist.name, disc: discs.length > 1 ? di + 1 : null, no: ti + 1 }))),
      });
    }
  }
  albums.push({
    artist: null,
    albumartist: COMPILATION.albumartist,
    title: COMPILATION.title, year: COMPILATION.year, genre: COMPILATION.genre,
    art: COMPILATION.art, sound: COMPILATION.sound,
    discs: [COMPILATION.tracks.map(([, t]) => t)],
    tracks: COMPILATION.tracks.map(([a, t], i) => ({ title: t, artist: a, disc: null, no: i + 1 })),
  });
  return albums;
}
