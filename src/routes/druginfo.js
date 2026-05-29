const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 3600 });

async function fetchDrugInfo({ name, type }) {
  const cacheKey = `${type}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let result;

  if (type === 'adverse_events') {
    const url = `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(name)}"&limit=10&sort=receiptdate:desc`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const events = (data.results || []).map(e => ({
      date: e.receiptdate,
      reactions: (e.patient?.reaction || []).map(r => r.reactionmeddrapt),
      serious: e.serious === '1' ? true : false,
      country: e.primarysourcecountry
    }));
    result = {
      success: true,
      drug_name: name,
      type: 'adverse_events',
      count: events.length,
      total_reports: data.meta?.results?.total,
      events,
      source: 'OpenFDA'
    };
  } else if (type === 'recalls') {
    const url = `https://api.fda.gov/drug/enforcement.json?search=product_description:"${encodeURIComponent(name)}"&limit=10&sort=report_date:desc`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const recalls = (data.results || []).map(r => ({
      date: r.report_date,
      reason: r.reason_for_recall,
      classification: r.classification,
      status: r.status,
      recalling_firm: r.recalling_firm
    }));
    result = {
      success: true,
      drug_name: name,
      type: 'recalls',
      count: recalls.length,
      recalls,
      source: 'OpenFDA'
    };
  } else {
    // label (default)
    const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(name)}"+OR+openfda.generic_name:"${encodeURIComponent(name)}"&limit=1`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const label = data.results?.[0];
    if (!label) throw new Error(`No label found for drug: ${name}`);

    const openfda = label.openfda || {};
    result = {
      success: true,
      drug_name: name,
      type: 'label',
      brand_names: openfda.brand_name || [],
      generic_name: (openfda.generic_name || [])[0] || null,
      purpose: label.purpose?.[0] || null,
      indications: label.indications_and_usage?.[0] || null,
      warnings: label.warnings?.[0] || null,
      dosage_and_administration: label.dosage_and_administration?.[0] || null,
      interactions: label.drug_interactions?.[0] || null,
      pregnancy: label.pregnancy?.[0] || label.pregnancy_or_breast_feeding?.[0] || null,
      source: 'OpenFDA'
    };
  }

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const name = req.query.name || 'metformin';
  const type = req.query.type || 'label';
  try {
    const data = await fetchDrugInfo({ name, type });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
