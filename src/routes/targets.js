const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

const CHEMBL_BASE = 'https://www.ebi.ac.uk/chembl/api/data';

async function fetchTargets({ name, type, chembl_id }) {
  const cacheKey = `${type}:${chembl_id || name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let result;

  if (type === 'activity' && chembl_id) {
    const url = `${CHEMBL_BASE}/activity?molecule_chembl_id=${chembl_id}&format=json&limit=10`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const activities = (data.activities || []).map(a => ({
      target_name: a.target_pref_name,
      target_organism: a.target_organism,
      activity_type: a.standard_type,
      value: a.standard_value,
      units: a.standard_units,
      relation: a.standard_relation,
      assay_description: a.assay_description
    }));
    result = {
      success: true,
      chembl_id,
      type: 'activity',
      count: activities.length,
      activities,
      source: 'ChEMBL / EMBL-EBI'
    };
  } else {
    // molecule (default)
    const url = `${CHEMBL_BASE}/molecule?pref_name__icontains=${encodeURIComponent(name)}&format=json&limit=3`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const molecules = data.molecules || [];
    if (!molecules.length) throw new Error(`No ChEMBL molecule found for: ${name}`);

    const top = molecules[0];
    const props = top.molecule_properties || {};
    result = {
      success: true,
      name: top.pref_name || name,
      chembl_id: top.molecule_chembl_id,
      max_phase: top.max_phase,
      molecule_type: top.molecule_type,
      properties: {
        molecular_weight: props.full_mwt || props.mw_freebase,
        alogp: props.alogp,
        hbd: props.hbd,
        hba: props.hba,
        psa: props.psa,
        rtb: props.rtb
      },
      indications: (top.indication_class || '').split(';').map(s => s.trim()).filter(Boolean),
      all_results: molecules.map(m => ({
        chembl_id: m.molecule_chembl_id,
        name: m.pref_name,
        max_phase: m.max_phase,
        molecule_type: m.molecule_type
      })),
      source: 'ChEMBL / EMBL-EBI'
    };
  }

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const name = req.query.name || 'ibuprofen';
  const type = req.query.type || 'molecule';
  const chembl_id = req.query.chembl_id || null;
  try {
    const data = await fetchTargets({ name, type, chembl_id });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
