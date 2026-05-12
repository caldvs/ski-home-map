/**
 * Worlds available in this deployment.
 *
 * The dashboard probes each `data` URL on load and greys out any
 * world whose graph JSON hasn't been built yet. Run
 * `scripts/build_data.py` to populate.
 *
 * Banner classes group resorts by sub-region for visual cohesion:
 *   tarentaise   — north central (Tignes, 3V, Les Arcs, La Plagne, La Rosière, Ste-Foy)
 *   maurienne    — southern (Val Cenis and friends)
 *   beaufortain  — north (Arêches, Espace Diamant)
 *   vanoise      — central (Pralognan, Valmorel)
 *   mega         — the two stitched mega-worlds
 */

export const WORLDS = {
  // ────── Tarentaise ──────
  tignes: {
    id: "tignes",
    name: "Tignes / Val d'Isère",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "Espace Killy — 8 villages across two valleys, the Grande Motte glacier, 1550–3450 m.",
    data: "./data/tignes.json",
    stats: { nodes: 374, edges: 1311, villages: 7 },
    initialView: { center: [6.913, 45.477], zoom: 13.2, pitch: 62, bearing: 190 },
  },
  "trois-vallees": {
    id: "trois-vallees",
    name: "Trois Vallées",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "Méribel · Courchevel · Val Thorens · Les Menuires. The largest linked area in France today.",
    data: "./data/trois-vallees.json",
    stats: { nodes: "≈ 875", edges: "≈ 3,700", villages: 10 },
    initialView: { center: [6.580, 45.350], zoom: 11.5, pitch: 0, bearing: 0 },
  },
  "les-arcs": {
    id: "les-arcs",
    name: "Les Arcs",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "Paradiski half. Arc 1600 / 1800 / 1950 / 2000 plus Peisey-Vallandry.",
    data: "./data/les-arcs.json",
    stats: { nodes: "≈ 500", edges: "≈ 2,400", villages: 5 },
    initialView: { center: [6.790, 45.595], zoom: 12, pitch: 0, bearing: 0 },
  },
  "la-plagne": {
    id: "la-plagne",
    name: "La Plagne",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "Paradiski's other half. Eight high-altitude villages around the Glaciers de Bellecôte.",
    data: "./data/la-plagne.json",
    stats: { nodes: "≈ 350", edges: "≈ 1,500", villages: 8 },
    initialView: { center: [6.690, 45.510], zoom: 12, pitch: 0, bearing: 0 },
  },
  "la-rosiere": {
    id: "la-rosiere",
    name: "La Rosière",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "South-facing Tarentaise resort linking to La Thuile (Italy) over the Petit-Saint-Bernard.",
    data: "./data/la-rosiere.json",
    stats: { nodes: "≈ 110", edges: "≈ 500", villages: 2 },
    initialView: { center: [6.855, 45.620], zoom: 13, pitch: 0, bearing: 0 },
  },
  "sainte-foy": {
    id: "sainte-foy",
    name: "Sainte-Foy Tarentaise",
    region: "Tarentaise",
    bannerClass: "tarentaise",
    description:
      "Small, cult-favourite off-piste resort sitting between Tignes and Les Arcs.",
    data: "./data/sainte-foy.json",
    stats: { nodes: "≈ 47", edges: "≈ 170", villages: 1 },
    initialView: { center: [6.919, 45.592], zoom: 13, pitch: 0, bearing: 0 },
  },

  // ────── Vanoise west ──────
  valmorel: {
    id: "valmorel",
    name: "Valmorel / Le Grand Domaine",
    region: "Vanoise west",
    bannerClass: "vanoise",
    description:
      "Linked with Saint-François-Longchamp. Family-oriented; gentler than Three Valleys next door.",
    data: "./data/valmorel.json",
    stats: { nodes: "≈ 130", edges: "≈ 470", villages: 2 },
    initialView: { center: [6.449, 45.462], zoom: 13, pitch: 0, bearing: 0 },
  },
  pralognan: {
    id: "pralognan",
    name: "Pralognan-la-Vanoise",
    region: "Vanoise",
    bannerClass: "vanoise",
    description:
      "Inside the Vanoise National Park boundary. Small, scenic, very quiet.",
    data: "./data/pralognan.json",
    stats: { nodes: "≈ 48", edges: "≈ 170", villages: 1 },
    initialView: { center: [6.724, 45.380], zoom: 13, pitch: 0, bearing: 0 },
  },

  // ────── Beaufortain (north) ──────
  "espace-diamant": {
    id: "espace-diamant",
    name: "Espace Diamant",
    region: "Beaufortain",
    bannerClass: "beaufortain",
    description:
      "Les Saisies · Notre-Dame-de-Bellecombe · Crest-Voland. Mont Blanc views.",
    data: "./data/espace-diamant.json",
    stats: { nodes: "≈ 285", edges: "≈ 950", villages: 3 },
    initialView: { center: [6.520, 45.780], zoom: 12, pitch: 0, bearing: 0 },
  },
  "areches-beaufort": {
    id: "areches-beaufort",
    name: "Arêches-Beaufort",
    region: "Beaufortain",
    bannerClass: "beaufortain",
    description:
      "Cult Beaufortain resort. Small lift network, lots of ski touring around it.",
    data: "./data/areches-beaufort.json",
    stats: { nodes: "≈ 60", edges: "≈ 240", villages: 2 },
    initialView: { center: [6.580, 45.685], zoom: 12.5, pitch: 0, bearing: 0 },
  },

  // ────── Maurienne (south) ──────
  "val-cenis": {
    id: "val-cenis",
    name: "Val Cenis",
    region: "Haute-Maurienne",
    bannerClass: "maurienne",
    description:
      "Espace Haute Maurienne Vanoise. Lanslebourg · Lanslevillard · Termignon.",
    data: "./data/val-cenis.json",
    stats: { nodes: "≈ 155", edges: "≈ 505", villages: 3 },
    initialView: { center: [6.880, 45.282], zoom: 12.5, pitch: 0, bearing: 0 },
  },
  "bonneval-sur-arc": {
    id: "bonneval-sur-arc",
    name: "Bonneval-sur-Arc",
    region: "Haute-Maurienne",
    bannerClass: "maurienne",
    description:
      "End of the Iseran road. Highest commune in the Maurienne; the most photogenic village in Savoie.",
    data: "./data/bonneval-sur-arc.json",
    stats: { nodes: "≈ 43", edges: "≈ 190", villages: 1 },
    initialView: { center: [7.048, 45.368], zoom: 13, pitch: 0, bearing: 0 },
  },
  aussois: {
    id: "aussois",
    name: "Aussois",
    region: "Maurienne",
    bannerClass: "maurienne",
    description:
      "Compact Maurienne resort with direct trail access into the Vanoise National Park.",
    data: "./data/aussois.json",
    stats: { nodes: "≈ 53", edges: "≈ 230", villages: 1 },
    initialView: { center: [6.743, 45.231], zoom: 13, pitch: 0, bearing: 0 },
  },
  "la-norma": {
    id: "la-norma",
    name: "La Norma",
    region: "Maurienne",
    bannerClass: "maurienne",
    description: "Purpose-built car-free resort on the south side of the Maurienne.",
    data: "./data/la-norma.json",
    stats: { nodes: "≈ 55", edges: "≈ 225", villages: 1 },
    initialView: { center: [6.715, 45.198], zoom: 13, pitch: 0, bearing: 0 },
  },
  valfrejus: {
    id: "valfrejus",
    name: "Valfréjus",
    region: "Maurienne",
    bannerClass: "maurienne",
    description: "Modjon plateau and the Punta Bagna ridge above the Maurienne.",
    data: "./data/valfrejus.json",
    stats: { nodes: "≈ 49", edges: "≈ 220", villages: 1 },
    initialView: { center: [6.662, 45.170], zoom: 13, pitch: 0, bearing: 0 },
  },
  "galibier-thabor": {
    id: "galibier-thabor",
    name: "Galibier-Thabor",
    region: "Maurienne",
    bannerClass: "maurienne",
    description:
      "Valloire + Valmeinier linked. The Col du Galibier above; full Mont Thabor traverse below.",
    data: "./data/galibier-thabor.json",
    stats: { nodes: "≈ 186", edges: "≈ 700", villages: 2 },
    initialView: { center: [6.460, 45.170], zoom: 12, pitch: 0, bearing: 0 },
  },

  // Synthetic-connector mega-worlds (Tignes+Trois Vallées, Savoie-16)
  // were experimental and removed — the cable cars over the Vanoise
  // didn't route in a useful way. Only contiguous real resorts above.
};
