require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const compoundRouter = require('./routes/compound');
const geneRouter = require('./routes/gene');
const druginfoRouter = require('./routes/druginfo');
const targetsRouter = require('./routes/targets');
const mcpRouter = require('./routes/mcp');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3022;
const PAY_TO = process.env.PAY_TO_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agentbio', port: PORT }));
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://bio.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});
app.get('/openapi.json', (req, res) => res.sendFile(require('path').join(__dirname, 'openapi.json')));

app.use('/mcp', mcpRouter);

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/bio/compound': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Drug/compound data from PubChem (NIH) — CID, IUPAC name, molecular formula, molecular weight, SMILES, InChI, description, and synonyms.',
        extensions: { bazaar: { info: {
          description: 'Drug and compound data from PubChem (NIH). Look up any drug or chemical compound by name or CID to get molecular formula, weight, SMILES, InChI, and synonyms.',
          input: { type: 'http', method: 'GET',
            queryParams: { name: 'aspirin' },
            schema: { properties: {
              name: { type: 'string', description: 'Drug or compound name (e.g. aspirin, caffeine, ibuprofen)' },
              cid: { type: 'string', description: 'PubChem CID number (alternative to name)' }
            }, required: [] }
          },
          output: { example: { success: true, name: 'aspirin', cid: 2244, formula: 'C9H8O4', molecular_weight: '180.16', smiles: 'CC(=O)Oc1ccccc1C(=O)O', source: 'PubChem / NIH' } }
        }}}
      },

      'GET /x402/bio/druginfo': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Drug label, safety info, adverse events, and recall data from OpenFDA — indications, warnings, dosage, interactions.',
        extensions: { bazaar: { info: {
          description: 'Drug label and safety information from OpenFDA. Get brand names, generic name, indications, warnings, dosage instructions, drug interactions, and pregnancy info.',
          input: { type: 'http', method: 'GET',
            queryParams: { name: 'metformin', type: 'label' },
            schema: { properties: {
              name: { type: 'string', description: 'Drug name (e.g. metformin, aspirin, lisinopril)' },
              type: { type: 'string', description: 'label (default), adverse_events, or recalls' }
            }, required: [] }
          },
          output: { example: { success: true, drug_name: 'metformin', type: 'label', brand_names: ['GLUCOPHAGE'], generic_name: 'METFORMIN HYDROCHLORIDE', source: 'OpenFDA' } }
        }}}
      },

      'GET /x402/bio/gene': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'NCBI Gene database — gene function, chromosome location, aliases, and disease associations.',
        extensions: { bazaar: { info: { description: 'NCBI Gene database — search by gene name/symbol. Returns gene function, chromosome location, organism, and description.', input: { type: 'http', method: 'GET', queryParams: { q: 'BRCA1', organism: 'Homo sapiens', limit: '5' }, schema: { properties: { q: { type: 'string', description: 'Gene name or symbol (e.g. BRCA1, TP53, EGFR)' }, organism: { type: 'string', description: 'Organism (default: Homo sapiens)' }, limit: { type: 'string' } }, required: [] } }, output: { example: { success: true, query: 'BRCA1', genes: [{ symbol: 'BRCA1', description: 'BRCA1 DNA repair associated', chromosome: '17', location: '17q21.31', aliases: ['FANCS', 'RNF53'] }] } } } } }
      },

      'GET /x402/bio/targets': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Drug target and bioactivity data from ChEMBL (EMBL-EBI) — ChEMBL ID, max clinical phase, molecular properties, indication class.',
        extensions: { bazaar: { info: {
          description: 'Drug target and bioactivity data from ChEMBL (EMBL-EBI). Get ChEMBL ID, max clinical phase, molecule type, molecular properties (MW, AlogP), and indication class.',
          input: { type: 'http', method: 'GET',
            queryParams: { name: 'ibuprofen', type: 'molecule' },
            schema: { properties: {
              name: { type: 'string', description: 'Drug or compound name (e.g. ibuprofen, atorvastatin)' },
              type: { type: 'string', description: 'molecule (default) or activity' },
              chembl_id: { type: 'string', description: 'ChEMBL ID for activity lookup (e.g. CHEMBL521)' }
            }, required: [] }
          },
          output: { example: { success: true, name: 'IBUPROFEN', chembl_id: 'CHEMBL521', max_phase: 4, molecule_type: 'Small molecule', source: 'ChEMBL / EMBL-EBI' } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('✅ x402 payment middleware registered');
} catch (err) {
  console.warn('⚠️  x402 middleware skipped:', err.message);
}

app.use('/x402/bio/compound', compoundRouter);
app.use('/x402/bio/gene', geneRouter);
app.use('/x402/bio/druginfo', druginfoRouter);
app.use('/x402/bio/targets', targetsRouter);

app.listen(PORT, () => console.log(`AgentBio running on port ${PORT}`));
