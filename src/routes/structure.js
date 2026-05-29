const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 86400 });

const PDB_ID_RE = /^[0-9][A-Z0-9]{3}$/i;

router.get('/', async (req, res) => {
  try {
    let { q = 'BRCA1', limit = 5 } = req.query;
    limit = Math.min(parseInt(limit) || 5, 10);
    const cacheKey = `structure:${q}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let pdbIds = [];

    if (PDB_ID_RE.test(q)) {
      pdbIds = [q.toUpperCase()];
    } else {
      // Search using RCSB full text search
      const searchBody = {
        query: { type: 'terminal', service: 'full_text', parameters: { value: q } },
        return_type: 'entry',
        request_options: { paginate: { start: 0, rows: limit }, sort: [{ sort_by: 'score', direction: 'desc' }] }
      };
      const { data: searchData } = await axios.post(
        'https://search.rcsb.org/rcsbsearch/v2/query',
        searchBody,
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      pdbIds = (searchData.result_set || []).slice(0, Math.min(limit, 5)).map(r => r.identifier);
    }

    // Fetch details for each PDB ID
    const structures = await Promise.all(pdbIds.map(async id => {
      try {
        const { data } = await axios.get(`https://data.rcsb.org/rest/v1/core/entry/${id}`, { timeout: 8000 });
        const info = data.rcsb_entry_info || {};
        return {
          pdb_id: id,
          title: data.struct?.title || '',
          method: data.exptl?.[0]?.method || 'unknown',
          resolution_angstrom: data.refine?.[0]?.ls_d_res_high || null,
          chains: info.deposited_polymer_entity_instance_count || null,
          molecular_weight: info.molecular_weight || null,
          url: `https://www.rcsb.org/structure/${id}`
        };
      } catch { return null; }
    }));

    const result = {
      success: true,
      query: q,
      total: pdbIds.length,
      count: structures.filter(Boolean).length,
      structures: structures.filter(Boolean),
      source: 'RCSB Protein Data Bank',
      disclaimer: 'Information only.'
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[bio/structure]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
