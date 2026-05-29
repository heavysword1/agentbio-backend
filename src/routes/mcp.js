const express = require('express');
const axios = require('axios');
const router = express.Router();

const TOOLS = [
  {
    name: 'get_compound_data',
    description: 'Get drug/compound data from PubChem (NIH). Returns CID, IUPAC name, molecular formula, molecular weight, canonical SMILES, InChI, description, and synonyms.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Drug or compound name (e.g. aspirin, caffeine, ibuprofen)', default: 'aspirin' },
        cid: { type: 'string', description: 'PubChem CID number (alternative to name)' }
      }
    }
  },
  {
    name: 'get_drug_info',
    description: 'Get drug label, safety info, adverse events, or recall data from OpenFDA. Returns brand names, generic name, indications, warnings, dosage, interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Drug name (e.g. metformin, aspirin, lisinopril)', default: 'metformin' },
        type: { type: 'string', description: 'label (default), adverse_events, or recalls', default: 'label' }
      }
    }
  },
  {
    name: 'get_drug_targets',
    description: 'Get drug target and bioactivity data from ChEMBL (EMBL-EBI). Returns ChEMBL ID, max clinical phase, molecule type, molecular properties, and indication class.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Drug or compound name (e.g. ibuprofen, atorvastatin)', default: 'ibuprofen' },
        type: { type: 'string', description: 'molecule (default) or activity', default: 'molecule' },
        chembl_id: { type: 'string', description: 'ChEMBL ID for activity lookup (e.g. CHEMBL521)' }
      }
    }
  }
];

async function executeTool(name, args) {
  const base = `http://localhost:${process.env.PORT || 3022}`;
  switch (name) {
    case 'get_compound_data': {
      const params = new URLSearchParams();
      if (args.cid) params.set('cid', args.cid);
      else params.set('name', args.name || 'aspirin');
      const { data } = await axios.get(`${base}/x402/bio/compound?${params}`, { timeout: 20000 });
      return data;
    }
    case 'get_drug_info': {
      const params = new URLSearchParams({ name: args.name || 'metformin', type: args.type || 'label' });
      const { data } = await axios.get(`${base}/x402/bio/druginfo?${params}`, { timeout: 20000 });
      return data;
    }
    case 'get_drug_targets': {
      const params = new URLSearchParams({ name: args.name || 'ibuprofen', type: args.type || 'molecule' });
      if (args.chembl_id) params.set('chembl_id', args.chembl_id);
      const { data } = await axios.get(`${base}/x402/bio/targets?${params}`, { timeout: 20000 });
      return data;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentBio', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: TOOLS.map(t => t.name) });
});

router.post('/', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AgentBio', version: '1.0.0' } };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args);
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

module.exports = router;
