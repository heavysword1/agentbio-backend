const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

async function fetchGenes({ q, organism, limit }) {
  const cacheKey = `gene:${q}:${organism}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const searchTerm = `${q}[gene]+AND+${organism}[Organism]`;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=${encodeURIComponent(searchTerm)}&retmax=${limit}&retmode=json`;

  const searchRes = await axios.get(searchUrl, { timeout: 15000 });
  const ids = searchRes.data?.esearchresult?.idlist || [];

  if (!ids.length) {
    return { success: true, query: q, organism, count: 0, genes: [], source: 'NCBI Gene Database' };
  }

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${ids.join(',')}&retmode=json`;
  const summaryRes = await axios.get(summaryUrl, { timeout: 15000 });
  const summaryData = summaryRes.data?.result || {};

  const genes = ids.map(id => {
    const g = summaryData[id];
    if (!g) return null;

    const aliases = (g.otheraliases || '').split(',').map(a => a.trim()).filter(Boolean).slice(0, 3);
    const summaryText = g.summary ? g.summary.slice(0, 200) : null;

    return {
      id: g.uid || id,
      symbol: g.name || null,
      name: g.description || null,
      description: g.description || null,
      chromosome: g.chromosome || null,
      location: g.maplocation || null,
      organism: g.organism?.scientificname || organism,
      aliases,
      summary_text: summaryText,
      url: `https://www.ncbi.nlm.nih.gov/gene/${g.uid || id}`
    };
  }).filter(Boolean);

  const result = {
    success: true,
    query: q,
    organism,
    count: genes.length,
    genes,
    source: 'NCBI Gene Database'
  };

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const q = req.query.q || 'BRCA1';
  const organism = req.query.organism || 'Homo sapiens';
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  try {
    const data = await fetchGenes({ q, organism, limit });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
