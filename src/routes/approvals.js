const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 3600 });

async function fetchApprovals({ name, type, limit }) {
  const size = Math.min(parseInt(limit, 10) || 5, 10);
  const cacheKey = `approvals:${name}:${type}:${size}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `https://api.fda.gov/drug/drugsfda.json?search=openfda.brand_name:%22${encodeURIComponent(name)}%22+OR+openfda.generic_name:%22${encodeURIComponent(name)}%22&limit=${size}`;
  const res = await axios.get(url, { timeout: 15000 });
  const results = res.data.results || [];

  const applications = results.map(app => {
    const product = app.products?.[0] || {};
    const brand_name = product.brand_name || null;
    const dosage_form = product.dosage_form || null;
    const generic_name = product.active_ingredients?.[0]?.name || null;
    const application_number = app.application_number || null;
    const applicant = app.applicant || null;

    const submissions = app.submissions || [];
    const total_submissions = submissions.length;

    // Find first approval (earliest AP)
    const approvals = submissions
      .filter(s => s.submission_type === 'ORIG' && s.action_type === 'AP' ||
                   s.action_type === 'AP')
      .sort((a, b) => (a.submission_status_date || '').localeCompare(b.submission_status_date || ''));

    const first_approved = approvals[0]?.submission_status_date || null;

    // Latest submission
    const latest = submissions
      .sort((a, b) => (b.submission_status_date || '').localeCompare(a.submission_status_date || ''))[0];
    const latest_action = latest ? {
      date: latest.submission_status_date || null,
      type: latest.action_type || null,
      submission_type: latest.submission_type || null
    } : null;

    return {
      application_number,
      applicant,
      brand_name,
      generic_name,
      dosage_form,
      first_approved,
      total_submissions,
      latest_action
    };
  });

  const result = {
    success: true,
    drug_name: name,
    count: applications.length,
    applications,
    source: 'FDA Drug Approvals Database'
  };

  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const name = req.query.name || 'metformin';
  const type = req.query.type || 'all';
  const limit = req.query.limit || 5;
  try {
    const data = await fetchApprovals({ name, type, limit });
    res.json(data);
  } catch (err) {
    const status = err.response?.status === 404 ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
