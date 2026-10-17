import fs from 'node:fs';
const file = process.argv[2] || 'infra/outputs.json';
const outputs = JSON.parse(fs.readFileSync(file, 'utf8'));
const values = outputs.ScreenRecStack || Object.values(outputs)[0];
for (const key of ['ApiUrl','CognitoDomain','UserPoolClientId','ViewerUrl']) if (!values?.[key]) throw new Error(`Missing CDK output: ${key}`);
const extension = `WXT_API_BASE=${values.ApiUrl.replace(/\/$/,'')}\nWXT_COGNITO_DOMAIN=${values.CognitoDomain}\nWXT_COGNITO_CLIENT_ID=${values.UserPoolClientId}\n`;
const web = `VITE_API_BASE=${values.ApiUrl.replace(/\/$/,'')}\n`;
for (const mode of ['development','production']) {
  fs.writeFileSync(`apps/extension/.env.${mode}.local`,extension);
  fs.writeFileSync(`apps/web/.env.${mode}.local`,web);
}
console.log('Wrote local public app configuration. Rebuild both apps.');
