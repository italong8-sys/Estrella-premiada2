const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS ASAAS
// =========================================================================
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "$asaasApiKey_substitua_aqui_se_nao_usar_env";
const ASAAS_URL = "https://www.asaas.com/api/v3/transfers"; 

// =========================================================================
// ROTA DE SAQUE PIX (ATUALIZADA PARA 1000 PONTOS = R$ 1,00)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes." });
        }

        // NOVO AJUSTE: Saque mínimo reduzido para 1000 pontos (R$ 1,00)
        const pontosMinimos = 1000;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 1.000 pontos (R$ 1,00)." });
        }

        // A matemática agora faz: 1000 * 0.001 = 1.00 Real
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
            error: mensagemErro 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`[SERVER OK] Motor Pix Asaas rodando na porta ${PORT}`);
});
