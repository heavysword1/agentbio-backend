const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

const ORGANISM_MAP = {
  human: 9606,
  mouse: 10090,
  rat: 10116,
  yeast: 559292
};

function resolveTaxon(organism) {
  if (!organism) return 9606;
  const lower = String(organism).toLowerCase();
  if (ORGANISM_MAP[lower]) return ORGANISM_MAP[lower];
  const num = parseInt(organism, 10);
  if (!isNaN(num)) return num;
  return 9606;
}

async function fetchUniprot({ q, organism, limit }) {
  const taxon = resolveTaxon(organism);
  const size = Math.min(parseInt(limit, 10) || 5, 20);
  const cacheKey = `uniprot:${q}:${taxon}:${size}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(q)}+AND+organism_id:${taxon}&format=json&size=${size}`;
  const res = await axios.get(url, { timeout: 15000 });
  const results = res.data.results || [];

  const proteins = results.map(entry => {
    const accession = entry.primaryAccession || null;
    const name = entry.proteinDescription?.recommendedName?.fullName?.value
      || entry.proteinDescription?.submissionNames?.[0]?.fullName?.value
      || null;
    const gene = entry.genes?.[0]?.geneName?.value || null;
    const length = entry.sequence?.length || null;
    const org = entry.organism?.scientificName || null;

    const funcComment = (entry.comments || []).find(c => c.commentType === 'FUNCTION');
    const funcText = funcComment?.texts?.[0]?.value || null;
    const func = funcText ? funcText.slice(0, 200) : null;

    return {
      accession,
      name,
      gene,
      length,
      organism: org,
      function: func,
      url: accession ? `https://www.uniprot.org/uniprot/${accession}` : null
    };
  });

  const result = {
    success: true,
    query: q,
    organism: organism || 'human',
    count: proteins.length,
    proteins,
    source: 'UniProt'
  };

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const q = req.query.q || 'BRCA1';
  const organism = req.query.organism || 'human';
  const limit = req.query.limit || 5;
  try {
    const data = await fetchUniprot({ q, organism, limit });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
