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
// ROTA DE SAQUE PIX COM VARREDURA EM LOOP INTEGRADA (ANTI-PERDA DE PONTOS)
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

        // 1. Cria o registro do Pix no Asaas
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
        console.log(`[PAYOUT PENDING] Registrado ID: ${transferId}. Iniciando varredura dinâmica no SPI...`);

        // =========================================================================
        // ENGINE DE VARREDURA EM LOOP (Mapeia o status real do Banco Central)
        // =========================================================================
        let statusReal = "PENDING";
        let motivoFalha = "";
        let tentativas = 0;
        const maxTentativas = 5; // 5 checagens de 1.5s = ~7.5 segundos de tolerância máxima

        while ((statusReal === "PENDING" || statusReal === "BANK_PROCESSING") && tentativas < maxTentativas) {
            // Aguarda 1.5 segundos entre as consultas
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            try {
                const responseCheck = await axios.get(`${ASAAS_URL}/${transferId}`, {
                    headers: {
                        'access_token': ASAAS_API_KEY,
                        'Content-Type': 'application/json'
                    }
                });
                statusReal = responseCheck.data.status;
                motivoFalha = responseCheck.data.failReason || "Autorização recusada pela instituição financeira receptora.";
                tentativas++;
                console.log(`[SPI POLLING - TENTATIVA ${tentativas}] Status atual: ${statusReal}`);
            } catch (checkError) {
                console.error("[POLLING ERROR] Falha ao consultar nó de status:", checkError.message);
                break;
            }
        }

        console.log(`[SPI FINAL VERDICT] Veredito após varredura: ${statusReal}`);

        // SE FALHAR OU FOR RECUSADO: Intercepta e avisa o front para preservar os pontos
        if (statusReal === "FAILED" || statusReal === "REFUSED" || statusReal === "CANCELED") {
            return res.status(400).json({
                success: false,
                error: `Recusa Externa: ${motivoFalha}`
            });
        }

        // SE CONTINUAR PRESO COMO PENDENTE (Comum em manutenção da madrugada do Bacen):
        // Bloqueia o sucesso para evitar que os pontos sumam sem garantia do dinheiro.
        if (statusReal === "PENDING" || statusReal === "BANK_PROCESSING") {
            return res.status(400).json({
                success: false,
                error: "O Banco Central está demorando para responder. Para sua segurança, a transação foi retida e seus pontos foram salvos. Tente novamente em instantes."
            });
        }

        // SÓ CHEGA AQUI SE O STATUS FOR COMPROVADAMENTE "DONE", "CONFIRMED" OU SIMILAR
        return res.status(200).json({ 
            success: true, 
            statusPix: statusReal,
            message: "Pix liquidado com sucesso!" 
        });

    } catch (error) {
        console.error("[CRITICAL CAPTURE] Exceção tratada no barramento.");
        
        if (error.response && error.response.data) {
            const asaasErrors = error.response.data.errors;
            if (asaasErrors && asaasErrors.length > 0) {
                return res.status(error.response.status).json({
                    success: false,
                    error: `Erro no Asaas: ${asaasErrors[0].description}`
                });
            }
        }
        
        const mensagemErro = error.message || "";
        return res.status(400).json({
            success: false,
            error: mensagemErro.includes("Recusa Externa") ? mensagemErro : "Transação recusada ou instabilidade temporária no processamento."
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
