const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

function isPdbId(q) {
  return /^[A-Za-z0-9]{4}$/.test(q);
}

async function fetchEntryDetails(pdb_id) {
  const url = `https://data.rcsb.org/rest/v1/core/entry/${pdb_id.toUpperCase()}`;
  const res = await axios.get(url, { timeout: 15000 });
  const d = res.data;
  return {
    pdb_id: pdb_id.toUpperCase(),
    title: d.struct?.title || null,
    method: d.exptl?.[0]?.method || null,
    resolution_angstrom: d.refine?.[0]?.ls_d_res_high || null,
    chains: d.rcsb_entry_info?.deposited_polymer_entity_instance_count || null,
    molecular_weight: d.rcsb_entry_info?.molecular_weight || null,
    url: `https://www.rcsb.org/structure/${pdb_id.toUpperCase()}`
  };
}

async function fetchStructure({ q, limit }) {
  const size = Math.min(parseInt(limit, 10) || 5, 10);
  const cacheKey = `structure:${q}:${size}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let structures = [];

  if (isPdbId(q)) {
    const detail = await fetchEntryDetails(q);
    structures = [detail];
  } else {
    const searchBody = {
      query: { type: 'terminal', service: 'text', parameters: { value: q } },
      return_type: 'entry',
      request_options: { paginate: { start: 0, rows: size } }
    };
    const searchRes = await axios.post('https://search.rcsb.org/rcsbsearch/v2/query', searchBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const hits = searchRes.data?.result_set || [];
    const topIds = hits.slice(0, 3).map(h => h.identifier);

    structures = await Promise.all(topIds.map(id => fetchEntryDetails(id).catch(() => null)));
    structures = structures.filter(Boolean);
  }

  const result = {
    success: true,
    query: q,
    count: structures.length,
    structures,
    source: 'RCSB Protein Data Bank'
  };

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const q = req.query.q || 'BRCA1';
  const limit = req.query.limit || 5;
  try {
    const data = await fetchStructure({ q, limit });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
