/**
 * Pre-built worlds available in this deployment.
 *
 * Each entry corresponds to a JSON file in /data/. The build script
 * (scripts/build_data.py) generates these by running `skiroute.build_graph`
 * + stitching against the OpenSkiData GeoPackage.
 */

export const WORLDS = {
  tignes: {
    id: "tignes",
    name: "Tignes / Val d'Isère",
    bannerClass: "tignes",
    description:
      "Espace Killy — 8 villages across two valleys, the Grande Motte glacier, 1550–3450 m.",
    data: "./data/tignes.json",
    stats: { nodes: 374, edges: 1311, villages: 7 },
    // Cinematic initial view: north of Tignes Le Lac, looking SW toward Val Claret + Grande Motte
    initialView: {
      center: [6.913, 45.477],
      zoom: 13.2,
      pitch: 62,
      bearing: 190,
    },
  },
  "tignes-three-valleys": {
    id: "tignes-three-valleys",
    name: "Tignes + Trois Vallées",
    bannerClass: "three-valleys",
    description:
      "Espace Killy stitched to the Trois Vallées via two synthetic cable cars across the Vanoise.",
    data: "./data/tignes-three-valleys.json",
    stats: { nodes: "≈ 1,250", edges: "≈ 5,000", villages: 17 },
    initialView: {
      center: [6.83, 45.44],
      zoom: 11.3,
      pitch: 0,
      bearing: 0,
    },
    comingSoon: true,
  },
  "savoie-16": {
    id: "savoie-16",
    name: "Savoie 16-resort mega",
    bannerClass: "savoie",
    description:
      "Sixteen real French Alpine resorts stitched into a single connected network. Largest hypothetical lift-linked area on earth.",
    data: "./data/savoie-16.json",
    stats: { nodes: "≈ 3,300", edges: "≈ 13,700", villages: 50 },
    initialView: {
      center: [6.75, 45.45],
      zoom: 10.5,
      pitch: 0,
      bearing: 0,
    },
    comingSoon: true,
  },
};
