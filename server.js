const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS MATRIZ
// =========================================================================
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || ""; 
const ASAAS_URL = "https://www.asaas.com/api/v3/transfers"; 
const ASAAS_URL_ACCOUNT = "https://www.asaas.com/api/v3/myAccount";

// =========================================================================
// ENGINE DE DIAGNÓSTICO DE BOOT (Health Check)
// =========================================================================
async function executarHealthCheckAsaas() {
    console.log("[HEALTH CHECK] Verificando integração com a API Asaas...");
    try {
        if (!ASAAS_API_KEY) {
            console.warn("[⚠️ WARNING] Chave ASAAS_API_KEY não detectada nas variáveis de ambiente do Render.");
            return;
        }
        const response = await axios.get(ASAAS_URL_ACCOUNT, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[🟢 HEALTH CHECK OK] Conexão ativa. Titular da Conta: ${response.data.name || "Identificado"}`);
    } catch (error) {
        console.error("[🔴 HEALTH CHECK ERROR] Falha de autenticação no Asaas:", error.message);
    }
}

// =========================================================================
// ROTA DE SAQUE PIX COM VERIFICAÇÃO DE ESTADO EM TEMPO REAL (SPI POLLING)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes no payload." });
        }

        const pontosMinimos = 500;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 500 pontos (R$ 0,50)." });
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

        console.log(`[PAYOUT INITIATED] Solicitando R$ ${valorReal} para chave [${tipoChave}] no Asaas...`);

        // 1. Envia a intenção de transferência para o lote do Asaas
        const responsePre = await axios.post(ASAAS_URL, {
            value: valorReal,
            pixAddressKey: chaveDestino,
            pixAddressKeyType: tipoChave
        }, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const transferId = responsePre.data.id;
        console.log(`[PAYOUT PENDING] Registrado ID: ${transferId}. Aguardando retorno da rede liquidante...`);

        // =========================================================================
        // BUFFER DE RETENÇÃO (Aguardando 2.5 segundos pelo veredito do Banco Central)
        // =========================================================================
        await new Promise(resolve => setTimeout(resolve, 2500));

        // 2. Consulta o status definitivo do item gerado
        const responseCheck = await axios.get(`${ASAAS_URL}/${transferId}`, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const statusReal = responseCheck.data.status;
        const motivoFalha = responseCheck.data.failReason || "Autorização externa recusada pela instituição financeira.";

        console.log(`[SPI TELEMETRY] Resposta do barramento central: ${statusReal}`);

        // Se falhar dentro da janela de retenção, aborta devolvendo erro e salvando os pontos
        if (statusReal === "FAILED" || statusReal === "REFUSED") {
            return res.status(400).json({
                success: false,
                error: `Recusa Externa: ${motivoFalha}`
            });
        }

        return res.status(200).json({ 
            success: true, 
            statusPix: statusReal,
            message: "Pix processado pela esteira com sucesso!" 
        });

    } catch (error) {
        console.error("[CRITICAL CAPTURE] Exceção na esteira de processamento.");
        
        if (error.response && error.response.data) {
            const asaasErrors = error.response.data.errors;
            if (asaasErrors && asaasErrors.length > 0) {
                return res.status(error.response.status).json({
                    success: false,
                    error: `Erro no Asaas: ${asaasErrors[0].description}`
                });
            }
            return res.status(error.response.status).json({ success: false, error: JSON.stringify(error.response.data) });
        }
        
        const mensagemErro = error.message || "";
        return res.status(400).json({
            success: false,
            error: mensagemErro.includes("Recusa Externa") ? mensagemErro : "Transação recusada pelo banco receptor ou timeout de conexão."
        });
    }
});

// =========================================================================
// INICIALIZAÇÃO DO ECOSSISTEMA
// =========================================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`[SERVER OK] Motor rodando perfeitamente na porta ${PORT}`);
    await executarHealthCheckAsaas();
});
