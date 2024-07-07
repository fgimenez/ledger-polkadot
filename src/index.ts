import { ApiPromise, WsProvider } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api-base/types';
import { PolkadotGenericApp } from '@zondax/ledger-substrate';
import transport from '@ledgerhq/hw-transport-node-hid';
import { hexToU8a } from '@polkadot/util';
import axios from 'axios';
import { ExtrinsicPayloadValue } from '@polkadot/types/types/extrinsic';
import { Command } from 'commander';

const DERIVATION_PATH_PREFIX = "m/44'/354'/0'/";
const CHAIN_ID = 'dot';
const METADATA_SERVER_URL = 'https://api.zondax.ch/polkadot';
const RPC_PROVIDER = 'wss://polkadot-rpc.publicnode.com';

const program = new Command();

async function initLedger() {
    const t = await transport.create();
    const ledger = new PolkadotGenericApp(t, CHAIN_ID, `${METADATA_SERVER_URL}/transaction/metadata`);
    await ledger.getVersion(); // Initialize the Ledger app
    return ledger;
}

async function connectToPolkadot() {
    const wsProvider = new WsProvider(RPC_PROVIDER);
    const api = await ApiPromise.create({ provider: wsProvider });
    return api;
}

async function common(accountType: number, addressIndex: number, extrinsic: SubmittableExtrinsic<'promise'>) {
    const ledger = await initLedger();
    const api = await connectToPolkadot();

    const derivationPath = `${DERIVATION_PATH_PREFIX}${accountType}'/${addressIndex}'`;
    console.log("derivation path " + derivationPath)
    const senderAddress = await ledger.getAddress(derivationPath, 0);
    console.log("sender address " + senderAddress.address)

    const nonceResp = await api.query.system.account(senderAddress.address);
    const { nonce } = nonceResp.toHuman() as any;
    console.log("nonce " + nonce)

    const resp = await axios.post(`${METADATA_SERVER_URL}/node/metadata/hash`, { id: CHAIN_ID });

    console.log("metadata hash " + resp.data.metadataHash)

    const payload = api.createType('ExtrinsicPayload', {
        method: extrinsic.method.toHex(),
        nonce: nonce as unknown as number,
        genesisHash: api.genesisHash,
        blockHash: api.genesisHash,
        transactionVersion: api.runtimeVersion.transactionVersion,
        specVersion: api.runtimeVersion.specVersion,
        runtimeVersion: api.runtimeVersion,
        version: api.extrinsicVersion,
        mode: 1,
        metadataHash: hexToU8a('01' + resp.data.metadataHash),
    });

    console.log("payload to sign[hex] " + Buffer.from(payload.toU8a(true)).toString("hex"))
    console.log("payload to sign[human] " + JSON.stringify(payload.toHuman(true)))

    const { signature } = await ledger.sign(derivationPath, Buffer.from(payload.toU8a(true)));

    console.log("signature " + signature.toString("hex"))

    const payloadValue: ExtrinsicPayloadValue = {
        era: payload.era,
        genesisHash: api.genesisHash,
        blockHash: api.genesisHash,
        method: extrinsic.method.toHex(),
        nonce: nonce as unknown as number,
        specVersion: api.runtimeVersion.specVersion,
        tip: 0,
        transactionVersion: api.runtimeVersion.transactionVersion,
        mode: 1,
        metadataHash: hexToU8a('01' + resp.data.metadataHash),
    };

    const signedExtrinsic = extrinsic.addSignature(senderAddress.address, signature, payloadValue);

    console.log("signedTx to broadcast[hex] " + Buffer.from(signedExtrinsic.toU8a()).toString("hex"))
    console.log("signedTx to broadcast[human] " + JSON.stringify(signedExtrinsic.toHuman(true)))

    await extrinsic.send((status) => {
        console.log(`Tx status: ${JSON.stringify(status)}`);
    });
}

async function transfer(accountType: number, addressIndex: number, recipient: string, amount: number) {
    const api = await connectToPolkadot();
    const extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);

    common(accountType, addressIndex, extrinsic);
}

async function bond(accountType: number, addressIndex: number, amount: number) {
    const api = await connectToPolkadot();
    const extrinsic = api.tx.staking.bondExtra(amount);

    common(accountType, addressIndex, extrinsic);
}

program
    .command('transfer')
    .description('Transfer DOT tokens')
    .option('-t, --account-type <number>', 'Account type for the derivation path', (value) => parseInt(value, 10), 0)
    .option('-i, --address-index <number>', 'Address index for the derivation path', (value) => parseInt(value, 10), 0)
    .requiredOption('-r, --recipient <address>', 'Recipient address')
    .requiredOption('-a, --amount <number>', 'Amount to transfer', parseInt)
    .action(async (cmd) => {
        await transfer(cmd.accountType, cmd.addressIndex, cmd.recipient, cmd.amount);
    });

program
    .command('bond')
    .description('Bond DOT tokens')
    .option('-t, --account-type <number>', 'Account type for the derivation path', (value) => parseInt(value, 10), 0)
    .option('-i, --address-index <number>', 'Account index for the derivation path', (value) => parseInt(value, 10), 0)
    .requiredOption('-a, --amount <number>', 'Amount to bond', parseInt)
    .action(async (cmd) => {
        await bond(cmd.accountType, cmd.addressIndex, cmd.amount);
    });

program.parse(process.argv);
