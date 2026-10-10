const PACK_COLORS = {
  "Exasperation Pack": [
    "#ffffff",
    "#000000"
  ],
  "Fanmade Exasperation Pack": [
    "#000000",
    "#ffffff"
  ],
  "Memory Pack": [
    "#16328d",
    "#5c2ac0"
  ],
  "greafer Pack": [
    "#7c0000",
    "#000000"
  ],
  "Geometry Pack": [
    "#ecf6ff",
    "#7a7f86"
  ],
  "XL Pack": [
    "#ff704f",
    "#ffc857"
  ],
  "XL Pack II": [
    "#ff4f8b",
    "#b65cff"
  ],
  "Possible Pack": [
    "#03ff6c",
    "#6bdcf0"
  ],
  "Old Impossible Nine Circles Pack": [
    "#ff2332",
    "#da4c29"
  ],
  "Sonic Wave Pack": [
    "#001323",
    "#2B98AB"
  ],
  "Group Beats Pack": [
    "#ff0000",
    "#0019fc"
  ],
  "Full Runs by 1 Player Pack": [
    "#0019fc",
    "#00ff55"
  ],
  "icedcave Pack": [
    "#292dff",
    "#03002e"
  ],
  "Silent Clubstep Pack": [
    "#d11002",
    "#00124d"
  ],
  "Main Level Pack": [
    "#005bd1",
    "#ffffff"
  ],
  "Brainrotted Pack": [
    "#215021",
    "#ff70cf"
  ],
  "Supreme Pack": [
    "#529dff",
    "#505a68"
  ],
  "Ship Carried Pack": [
    "#ff65d9",
    "#303030"
  ],
  "KOM Trilogy Pack": [
    "#993aff",
    "#10042c"
  ],
  "IiIOpTiCaLIiI Pack": [
    "#db2626",
    "#9e4ae2"
  ],
  "Challenge Pack": [
    "#a05e3f",
    "#ffd183"
  ],
  "ILL Top 1 Pack": [
    "#318a73",
    "#1b523f"
  ],
  "Mirror Portal Pack": [
    "#ff8800",
    "#31c5ff"
  ],
  "Silent Clubstep Pack II": [
    "#ffc505",
    "#000000"
  ],
  "Fredrick Pack": [
    "#52e92d",
    "#ffffff"
  ],
  "Grandson Pack": [
    "#770014",
    "#3f002c"
  ],
  "One Gamemode Pack": [
    "#51e5d0",
    "#7ba6ff"
  ],
  "Old Impossible Pack": [
    "#ef5350",
    "#000000"
  ],
  "Old Impossible Pack II": [
    "#f56931",
    "#000000"
  ],
  "Old Impossible Pack III": [
    "#e9bdbd",
    "#000000"
  ],
  "Unnerfed Pack": [
    "#ff3f3f",
    "#98e7ff"
  ],
  "Unnerfed Pack II": [
    "#eb4848",
    "#5fa4ff"
  ],
  "Christmas Pack": [
    "#ff5263",
    "#68e39b"
  ],
  "SupremeSDB's Favorite Picks": [
    "#505a68",
    "#529dff"
  ],
  "RMGD Legend": [
    "#2C211A",
    "#1F131F"
  ],
  "Legend Pack": [
    "#002353",
    "#001D2C"
  ],
  "Blast Processing Pack": [
    "#ff9100",
    "#35ff02"
  ],
  "PML Day One Pack": [
    "#8900be",
    "#00ff40"
  ],
  "Anceps Pack": [
    "#ffffff",
    "#ff3d02"
  ],
  "Satanic Pack": [
    "#f44761",
    "#630c00"
  ],
  "Satanic Pack II": [
    "#c62848",
    "#ff5c35"
  ],
  "Bloodshadow Pack": [
    "#f5300e",
    "#611f27"
  ],
  "Polis Pack": [
    "#5e5e5e",
    "#0a160c"
  ],
  "Never Clear Pack": [
    "#ff899d",
    "#940000"
  ],
  "Rampant Pack": [
    "#474747",
    "#131312"
  ], 
 "Swift Pack": [
    "#a8ff9e",
    "#ff9eff"
  ]
};

const PACKS = Object.keys(PACK_COLORS)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  .map((name) => ({ name, levels: [] }));
