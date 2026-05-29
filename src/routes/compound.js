const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

async function fetchCompound({ name, cid }) {
  const cacheKey = cid ? `cid:${cid}` : `name:${name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let compoundData, descriptionData;

  if (cid) {
    const [compRes] = await Promise.all([
      axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/JSON`, { timeout: 15000 })
    ]);
    compoundData = compRes.data;
  } else {
    const [compRes, descRes] = await Promise.all([
      axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/JSON`, { timeout: 15000 }),
      axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/description/JSON`, { timeout: 15000 }).catch(() => null)
    ]);
    compoundData = compRes.data;
    descriptionData = descRes?.data;
  }

  const compound = compoundData.PC_Compounds?.[0];
  if (!compound) throw new Error('Compound not found');

  const resolvedCid = compound.id?.id?.cid;
  const props = {};
  for (const p of (compound.props || [])) {
    const label = p.urn?.label;
    const name2 = p.urn?.name;
    const key = name2 ? `${label}:${name2}` : label;
    props[key] = p.value?.sval || p.value?.fval || p.value?.ival || p.value?.binary;
  }

  const iupacName = props['IUPAC Name:Preferred'] || props['IUPAC Name:Traditional'] || props['IUPAC Name:Systematic'] || null;
  const formula = props['Molecular Formula'] || null;
  const mw = props['Molecular Weight'] || null;
  const smiles = props['SMILES:Canonical'] || props['SMILES:Isomeric'] || null;
  const inchi = props['InChI:Standard'] || null;

  const synonyms = (compoundData.PC_Compounds?.[0]?.synonyms || []).slice(0, 5);

  // Get description from description endpoint or compound info
  let description = null;
  if (descriptionData?.InformationList?.Information?.length) {
    const info = descriptionData.InformationList.Information.find(i => i.Description);
    description = info?.Description || null;
  }

  const result = {
    success: true,
    name: name || `CID:${cid}`,
    cid: resolvedCid,
    formula,
    molecular_weight: mw,
    smiles,
    inchi,
    description,
    synonyms,
    source_url: `https://pubchem.ncbi.nlm.nih.gov/compound/${resolvedCid}`,
    source: 'PubChem / NIH'
  };

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const name = req.query.name || 'aspirin';
  const cid = req.query.cid || null;
  try {
    const data = await fetchCompound({ name: cid ? null : name, cid });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
