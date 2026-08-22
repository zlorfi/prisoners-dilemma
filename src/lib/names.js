'use strict';

/**
 * Aliases for anonymous voters. Pop-culture gangsters: mob movies, prestige
 * TV crime drama, heist crews, anime/game syndicates and a few comic-book
 * crooks. Kept deliberately large so a room rarely exhausts the pool.
 */
const RAW_NAME_POOL = [
  // --- The Godfather -------------------------------------------------------
  'Vito Corleone', 'Michael Corleone', 'Sonny Corleone', 'Fredo Corleone',
  'Tom Hagen', 'Peter Clemenza', 'Salvatore Tessio', 'Luca Brasi',
  'Moe Greene', 'Hyman Roth', 'Frank Pentangeli', 'Virgil Sollozzo',
  'Connie Corleone', 'Johnny Fontane', 'Don Barzini', 'Carlo Rizzi',

  // --- Goodfellas / Casino / Scorsese -------------------------------------
  'Henry Hill', 'Jimmy Conway', 'Tommy DeVito', 'Paulie Cicero',
  'Billy Batts', 'Karen Hill', 'Sam Rothstein', 'Nicky Santoro',
  'Ginger McKenna', 'Frank Costello', 'Colin Sullivan', 'Frank Sheeran',
  'Russell Bufalino', 'Jimmy Hoffa', 'Whitey Bulger', 'Amsterdam Vallon',
  'Bill the Butcher',

  // --- Scarface / Carlito / De Palma --------------------------------------
  'Tony Montana', 'Manny Ribera', 'Elvira Hancock', 'Frank Lopez',
  'Alejandro Sosa', 'Carlito Brigante', 'Dave Kleinfeld', 'Benny Blanco',

  // --- The Sopranos --------------------------------------------------------
  'Tony Soprano', 'Christopher Moltisanti', 'Paulie Walnuts', 'Silvio Dante',
  'Big Pussy', 'Junior Soprano', 'Furio Giunta', 'Ralph Cifaretto',
  'Bobby Baccalieri', 'Richie Aprile', 'Johnny Sack', 'Phil Leotardo',
  'Adriana La Cerva', 'Livia Soprano', 'Artie Bucco',

  // --- The Wire ------------------------------------------------------------
  'Avon Barksdale', 'Stringer Bell', 'Omar Little', 'Marlo Stanfield',
  'Proposition Joe', 'Chris Partlow', 'Snoop Pearson', 'Bodie Broadus',
  'Wee-Bey Brice', 'Cutty Wise', 'The Greek', 'Slim Charles',
  'Brother Mouzone',

  // --- Breaking Bad / Better Call Saul -------------------------------------
  'Heisenberg', 'Gus Fring', 'Mike Ehrmantraut', 'Tuco Salamanca',
  'Hector Salamanca', 'Lalo Salamanca', 'Nacho Varga', 'Saul Goodman',
  'Jesse Pinkman', 'Todd Alquist', 'Don Eladio', 'Huell Babineaux',

  // --- Peaky Blinders ------------------------------------------------------
  'Thomas Shelby', 'Arthur Shelby', 'Polly Gray', 'Alfie Solomons',
  'Michael Gray', 'John Shelby', 'Darby Sabini', 'Luca Changretta',
  'Alfie the Baker', 'Alfie Solomons Jr',

  // --- Boardwalk Empire / prohibition era ----------------------------------
  'Nucky Thompson', 'Chalky White', 'Richard Harrow', 'Arnold Rothstein',
  'Gyp Rosetti', 'Al Capone', 'Lucky Luciano', 'Meyer Lansky',
  'Bugsy Siegel', 'Dutch Schultz', 'Owney Madden', 'Waxey Gordon',

  // --- Heist crews ---------------------------------------------------------
  'Danny Ocean', 'Rusty Ryan', 'Linus Caldwell', 'Reuben Tishkoff',
  'Terry Benedict', 'Mr Blonde', 'Mr Orange', 'Mr Pink', 'Mr White',
  'Mr Blue', 'Mr Brown', 'The Professor', 'Tokyo', 'Berlin', 'Nairobi',
  'Rio', 'Denver', 'Moscow', 'Helsinki', 'Palermo', 'Lisbon',
  'Neil McCauley', 'Chris Shiherlis', 'Michael Cheritto', 'Doc McCready',

  // --- Comic book / animation crooks ---------------------------------------
  'Carmine Falcone', 'Sal Maroni', 'Oswald Cobblepot', 'Roman Sionis',
  'Kingpin', 'Tombstone', 'Hammerhead', 'Silvio Manfredi',
  'Bebop and Rocksteady', 'Fat Tony', 'Legs', 'Louie',
  'Snake Jailbird', 'Johnny Tightlips',

  // --- Games ---------------------------------------------------------------
  'Niko Bellic', 'Tommy Vercetti', 'Carl Johnson', 'Trevor Philips',
  'Michael De Santa', 'Franklin Clinton', 'Big Smoke', 'Ryder',
  'Sonny Forelli', 'Lance Vance', 'Salvatore Leone', 'Donald Love',
  'Vito Scaletta', 'Joe Barbaro', 'Tommy Angelo', 'Lincoln Clay',
  'Sam Giancana', 'Arthur Morgan', 'Dutch van der Linde', 'Micah Bell',
  'John Marston', 'Hosea Matthews', 'Bill Williamson', 'Javier Escuella',

  // --- Anime / Asian cinema syndicates -------------------------------------
  'Spike Spiegel', 'Vicious', 'Jet Black', 'Faye Valentine',
  'Kazuma Kiryu', 'Goro Majima', 'Taiga Saejima', 'Ryuji Goda',
  'Sosuke Aizen', 'Revy Two Hands', 'Balalaika', 'Dutch Rock',
  'Benny Rock', 'Mr Chang', 'Hotel Moscow', 'Ip Man',
  'Wong Chi-wai', 'Lau Kin-ming', 'Chan Wing-yan', 'Sam Hon',

  // --- Assorted classics ---------------------------------------------------
  'Keyser Soze', 'Verbal Kint', 'Dean Keaton', 'Fenster', 'McManus',
  'Todd Hockney', 'Marsellus Wallace', 'Vincent Vega', 'Jules Winnfield',
  'Mia Wallace', 'Winston Wolfe', 'Butch Coolidge', 'Honey Bunny',
  'Ringo Pumpkin', 'The Dude', 'Jackie Brown', 'Ordell Robbie',
  'Louis Gara', 'Bonnie Parker', 'Clyde Barrow', 'John Dillinger',
  'Pretty Boy Floyd', 'Baby Face Nelson', 'Machine Gun Kelly',
  'Mickey Cohen', 'Bumpy Johnson', 'Frank Lucas', 'Nicky Barnes',
  'Griselda Blanco', 'Pablo Escobar', 'Gustavo Gaviria', 'Jose Rodriguez',
  'El Mencho', 'La Quica', 'Poison Chavez', 'Nino Brown',
  'Scarface Brown', 'Gee Money', 'Priest Youngblood', 'Youngblood Priest',
  'Sportin Life', 'Doughboy Baker', 'O-Dog', 'Caine Lawson',
  'Tony D Aquila', 'Rico Bandello', 'Tom Powers', 'Cody Jarrett',
  'Roy Earle', 'Johnny Rocco', 'Vito Genovese', 'Joe Masseria',
  'Salvatore Maranzano', 'Frank Nitti', 'Johnny Torrio', 'Bugs Moran',
];

/**
 * Normalised key used for uniqueness checks so that "Tony Montana",
 * "tony  montana" and "TONY MONTANA" are all considered the same person.
 * Diacritics are folded too.
 */
function nameKey(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Trim, collapse whitespace and strip control characters for display. */
function cleanName(name) {
  return String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

// De-duplicate on the normalised key so an accidental double entry in the
// list above cannot shrink the effective pool or break assumptions elsewhere.
const POOL_KEYS = new Map();
for (const name of RAW_NAME_POOL) {
  const key = nameKey(name);
  if (key && !POOL_KEYS.has(key)) POOL_KEYS.set(key, name);
}
const NAME_POOL = [...POOL_KEYS.values()];

module.exports = {
  NAME_POOL,
  POOL_KEYS,
  nameKey,
  cleanName,
  POOL_SIZE: NAME_POOL.length,
};
