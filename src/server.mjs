import {resolve} from 'node:path';
import {makeBroker} from './broker.mjs';

const host=process.env.PRINTSERVER_BIND||'127.0.0.1';
const port=Number(process.env.PRINTSERVER_PORT||8097);
if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535){
 throw Error('printserver_invalid_binding');
}
const broker=await makeBroker({
 file:resolve(process.env.PRINTSERVER_DATA_FILE||'./data/jobs.json'),
 adminToken:process.env.PRINTSERVER_MCP_TOKEN,
 agentToken:process.env.PRINTSERVER_AGENT_TOKEN
});
const server=await broker.listen(port,host);
console.log(JSON.stringify({service:'printserver',state:'ready',host,port:server.address().port}));
