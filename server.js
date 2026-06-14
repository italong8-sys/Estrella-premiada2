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
// ENGINE DE DIAGNÓSTICO INTROSPECTIVO (Health Check de Boot)
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
        console.log("[DEBUG] Chaves validadas no barramento:", Object.keys(payload));

        const contaId = payload.id || "Não exposto no nível raiz";
        const titular = payload.name || "Não localizado";
        const tipoPessoa = payload.personType || "Não localizado";
        
        // Mapeamento dinâmico baseado no log real da sua conta homologada
        const statusComercial = payload.status || payload.commercialApproval || "UNDEFINED";

        console.log("\n====================================================");
        console.log("📊 MATRIZ DE CONFIGURAÇÃO DE CONTA - ASAAS");
        console.log("====================================================");
        console.log(`ID da Conta:      ${contaId}`);
        console.log(`Titular:          ${titular}`);
        console.log(`Tipo de Pessoa:   ${tipoPessoa}`);
        console.log("----------------------------------------------------");
        
        switch (statusComercial.toString().toUpperCase()) {
            case "APPROVED":
            case "ACTIVE":
            case "ATIVO":
                console.log("🟢 STATUS: APPROVED/ACTIVE (Conta 100% Homologada)");
                console.log("[🎯 LIBERADO] O pipeline de Payout/SPI está destravado. Requisições Pix via API serão liquidadas em tempo real.");
                break;
            case "PENDING":
                console.log("🟡 STATUS: PENDING (Em Análise Comercial de Risco)");
                console.log("[🚧 TRAVADO] O envio de Pix via API falhará até a liberação da feature flag de Payout.");
                break;
            default:
                console.log(`❓ STATUS DETECTADO: ${statusComercial}`);
        }
        console.log("====================================================\n");

    } catch (error) {
        console.error("[CRITICAL ERROR] Falha ao consultar o endpoint de metadados:", error.message);
    }
}

// =========================================================================
// ROTA DE SAQUE PIX COM TELEMETRIA DE ERROS AVANÇADA (Ajuste Centavo a Centavo)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes no payload." });
        }

        const pontosMinimos = 1000;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 1.000 pontos (R$ 1,00)." });
        }

        // Conversão matemática estrita: 1.000 pontos = R$ 1,00
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

        console.log(`[PAYOUT] Processando requisição de R$ ${valorReal} para chave [${tipoChave}]`);

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
            return res.status(500).json({ success: false, error: "O gateway recusou o processamento do lote Pix." });
        }

    } catch (error) {
        console.error("[CRITICAL CAPTURE] Captura de exceção no barramento de Payout.");
        
        if (error.response && error.response.data) {
            const asaasErrors = error.response.data.errors;
            
            if (asaasErrors && asaasErrors.length > 0) {
                const erroPrincipal = asaasErrors[0];
                console.error(`-> Código Asaas: ${erroPrincipal.code} | Descrição: ${erroPrincipal.description}`);
                
                // Retorna o erro real do Asaas direto para o modal de alerta do seu jogo
                return res.status(error.response.status).json({
                    success: false,
                    error: `Erro no Asaas (${erroPrincipal.code}): ${erroPrincipal.description}`
                });
            }
            return res.status(error.response.status).json({ success: false, error: JSON.stringify(error.response.data) });
        }

        return res.status(500).json({ success: false, error: `Falha de conexão com a API: ${error.message}` });
    }
});

// =========================================================================
// INICIALIZAÇÃO E VINCULAÇÃO DE PORTA REQUERIDA PELO RENDER
// =========================================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`[SERVER OK] Motor Pix Asaas rodando na porta ${PORT}`);
    await executarHealthCheckAsaas();
});
