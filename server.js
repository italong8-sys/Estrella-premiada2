const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS MATRIZ
// =========================================================================
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "$asaasApiKey_substitua_aqui_se_nao_usar_env";
const ASAAS_URL = "https://www.asaas.com/api/v3/transfers"; 
const ASAAS_URL_ACCOUNT = "https://www.asaas.com/api/v3/myAccount";

// =========================================================================
// ENGINE DE DIAGNÓSTICO INTROSPECTIVO (Anti-Undefined)
// =========================================================================
async function executarHealthCheckAsaas() {
    console.log("[HEALTH CHECK] Iniciando varredura cadastral no nó do Asaas...");
    try {
        const response = await axios.get(ASAAS_URL_ACCOUNT, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const payload = response.data;

        // DEBUG INTROSPECTIVO: Mapeia as chaves reais devolvidas pela API no log do Render
        console.log("[DEBUG] Estrutura de chaves recebida do Asaas:", Object.keys(payload));

        // MAPEAMENTO DEFENSIVO: Busca por chaves primárias ou mapeamentos alternativos no JSON
        const contaId = payload.id || payload.apiKeyId || "Não exposto no nível raiz";
        const titular = payload.name || "Não localizado";
        const tipoPessoa = payload.personType || "Não localizado";
        
        // RESOLUÇÃO DE STATUS COMERCIAL (Varredura de propriedades redundantes do ecossistema Asaas)
        const statusComercial = payload.commercialApproval || payload.status || payload.accountStatus || "UNDEFINED";

        console.log("\n====================================================");
        console.log("📊 MATRIZ DE CONFIGURAÇÃO DE CONTA - ASAAS");
        console.log("====================================================");
        console.log(`ID da Conta:      ${contaId}`);
        console.log(`Titular:          ${titular}`);
        console.log(`Tipo de Pessoa:   ${tipoPessoa}`);
        console.log("----------------------------------------------------");
        
        // ENGINE DE DECISÃO DE RISK COMPLIANCE
        switch (statusComercial.toString().toUpperCase()) {
            case "APPROVED":
            case "ACTIVE":
            case "ATIVO":
                console.log("🟢 STATUS: APPROVED/ACTIVE (Conta 100% Homologada)");
                console.log("[🎯 LIBERADO] O pipeline de Payout/SPI está destravado. Requisições Pix via API serão liquidadas em tempo real.");
                break;
            case "PENDING":
            case "EM_ANALISE":
                console.log("🟡 STATUS: PENDING (Em Análise Comercial de Risco)");
                console.log("[🚧 TRAVADO] Seus documentos foram recebidos, mas o comitê de compliance do Asaas ainda não virou a chave da API. O Pix de saída falhará na rede externa (Banco Central).");
                break;
            case "REJECTED":
            case "RECUSADO":
                console.log("🔴 STATUS: REJECTED (Cadastro Recusado)");
                console.log("[❌ BLOQUEIO TOTAL] A conformidade bancária rejeitou a documentação ou detectou inconsistência cadastral.");
                break;
            case "AWAITING_APPROVAL":
            case "AGUARDANDO_APROVACAO":
                console.log("🔵 STATUS: AWAITING_APPROVAL (Aguardando Fluxo de Onboarding)");
                console.log("[⚠️ AÇÃO REQUERIDA] Finalize as etapas pendentes (Biometria/Selfie) no app móvel do Asaas.");
                break;
            default:
                console.log(`❓ STATUS DETCONHECIDO OU AGUARDANDO CONFIGURAÇÃO: ${statusComercial}`);
                console.log("[ℹ️ INFORMAÇÃO] O Asaas opera esta conta sob regime restrito de Sandbox/Onboarding manual.");
        }
        console.log("====================================================\n");

    } catch (error) {
        console.error("[CRITICAL ERROR] Falha ao consultar o endpoint de metadados:");
        if (error.response) {
            console.error(`Status Code: ${error.response.status}`);
            console.error("Payload de Erro:", error.response.data);
        } else {
            console.error("Mensagem de Sistema:", error.message);
        }
    }
}

// =========================================================================
// ROTA DE SAQUE PIX (REGRA CONFIGURADA: 1000 PONTOS = R$ 1,00)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes." });
        }

        const pontosMinimos = 1000;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 1.000 pontos (R$ 1,00)." });
        }

        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));

        let tipoChave = "EVP"; 
        let chaveDestino = chavePix.trim();

        if (chaveDestino.includes("@")) {
            tipoChave = "EMAIL";
        } else if (/^\d{11}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CPF";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        } else if (/^\d{14}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CNPJ";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        } else if (/^\+?\d{10,13}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "PHONE";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        }

        const response = await axios.post(ASAAS_URL, {
            value: valorReal,
            pixAddressKey: chaveDestino,
            pixAddressKeyType: tipoChave
        }, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 || response.status === 201) {
            return res.status(200).json({ 
                success: true, 
                message: "Pix enviado e liquidado com sucesso via Asaas!" 
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: "O integrador recusou o processamento do Pix." 
            });
        }

    } catch (error) {
        console.error("Erro crítico no Payout Asaas:", error.response ? error.response.data : error.message);
        
        let mensagemErro = "Falha de comunicação interna com o motor de pagamentos Asaas.";
        if (error.response && error.response.data && error.response.data.errors) {
            mensagemErro = error.response.data.errors[0].description;
        } else if (error.message) {
            mensagemErro = error.message;
        }

        return res.status(500).json({ 
            success: false, 
            error: mensajeErro 
        });
    }
});

// =========================================================================
// INICIALIZAÇÃO DO SERVIDOR COM TRIGGER DE BOOT
// =========================================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`[SERVER OK] Motor Pix Asaas rodando na porta ${PORT}`);
    await executarHealthCheckAsaas();
});
