const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Permite que o seu jogo (front-end) se comunique com o servidor sem bloqueios de CORS
app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS ASAAS (Busca do Render ou usa a de testes)
// =========================================================================
// Cadastre a variável ASAAS_API_KEY na aba Environment do seu Render
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "$asaasApiKey_substitua_aqui_se_nao_usar_env";

// URL de Produção. (Para testar em homologação mude para: "https://sandbox.asaas.com/api/v3/transfers")
const ASAAS_URL = "https://www.asaas.com/api/v3/transfers"; 

// =========================================================================
// ROTA DE SAQUE PIX (MANTÉM O MESMO ENDPOINT PARA O SEU JOGO NÃO PRECISAR DE MUDANÇAS)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        // 1. Validações fundamentais de segurança no servidor
        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes." });
        }

        const pontosMinimos = 5000;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 5.000 pontos." });
        }

        // 2. Cálculo do valor real com base nos pontos (100 pontos = R$ 0,10)
        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));

        // 3. Detecção e Formatação Estrita exigida pela API do Asaas
        let tipoChave = "EVP"; // Padrão chave aleatória
        let chaveDestino = chavePix.trim();

        if (chaveDestino.includes("@")) {
            tipoChave = "EMAIL";
        } else if (/^\d{11}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CPF";
            chaveDestino = chaveDestino.replace(/\D/g, ""); // Asaas exige apenas os 11 números limpos
        } else if (/^\d{14}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CNPJ";
            chaveDestino = chaveDestino.replace(/\D/g, ""); // Apenas números limpos
        } else if (/^\+?\d{10,13}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "PHONE";
            chaveDestino = chaveDestino.replace(/\D/g, ""); // Apenas números com DDD
        }

        // 4. Disparo Real da transferência de saída (Payout) via Asaas API
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

        // 5. Verificação de Sucesso do Asaas
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
        
        // Pega o texto explicativo do erro direto de dentro do payload de retorno do Asaas
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

// Inicialização estável na porta exigida pelo Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`[SERVER OK] Motor Pix Asaas rodando perfeitamente na porta ${PORT}`);
});
