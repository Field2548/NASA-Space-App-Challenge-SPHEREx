// World progress on the home page: how many HEALPix boxes of the whole sky have a checked visit
// (GET /api/density?layer=checked, docs/contracts/api.md section 8).
export const WORLD_ORDER = 4;
export const WORLD_TOTAL = 12 * 4 ** WORLD_ORDER; // 3072 boxes
export const WORLD_URL = `/api/density?layer=checked&order=${WORLD_ORDER}&who=all`;
