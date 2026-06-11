const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Permite que o seu jogo (front-end) se comunique com o servidor sem bloqueios de CORS
app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS (Busca do Render ou usa o Token de Fallback)
// =========================================================================
const GATEWAY_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "APP_USR-7218605027356877-060621-5159232083e305465b657a62c03ffe40-163518318";

// =========================================================================
// ROTA DE SAQUE PIX - FORMATO REAL DE TRANSFERÊNCIA (BUSINESS-PAYOUTS)
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

        // 2. Cálculo Blindado no Back-end (Evita modificações manuais no navegador do cliente)
        // Regra de Conversão: 100 pontos = R$ 0,10 (Ou seja, pontos * 0.001)
        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));

        // 3. Detecção Inteligente e Higienização do Tipo de Chave Pix
        let tipoChave = "evp"; // Chave aleatória (EVP) por padrão
        let chaveDestino = chavePix.trim();

        if (chaveDestino.includes("@")) {
            tipoChave = "email";
        } else if (/^\d{11}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "cpf";
            chaveDestino = chaveDestino.replace(/\D/g, ""); // Remove pontos e traços exigidos pelo banco
        } else if (/^\d{14}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "cnpj";
            chaveDestino = chaveDestino.replace(/\D/g, ""); // Remove formatação de CNPJ
        } else if (/^\+?\d{10,13}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "phone"; // Número de telefone
        }

        // 4. Integração Real com o Endpoint de Payout (Envio/Transferência de Saldo)
        const response = await axios.post('https://api.mercadopago.com/v1/business-payouts', {
            payout_method_id: "pix",
            amount: valorReal,
            payout_info: {
                type: tipoChave,
                account_id: chaveDestino
            },
            description: "Resgate de Recompensa Automática - Star Runner Game"
        }, {
            headers: {
                'Authorization': `Bearer ${GATEWAY_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `saque_pix_${Date.now()}_${Math.floor(Math.random() * 1000)}` // Chave anti-duplicação de transações
            }
        });

        // 5. Retorno de Sucesso para o Jogo
        if (response.status === 201 || response.status === 200) {
            return res.status(200).json({ 
                success: true, 
                message: "Pix enviado e transferido com sucesso para a conta do usuário!" 
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: "O gateway recusou o processamento da transferência." 
            });
        }

    } catch (error) {
        console.error("Erro crítico no processamento do Payout:", error.response ? error.response.data : error.message);
        
        // Captura a mensagem de rejeição real vinda de dentro do Mercado Pago (ex: saldo insuficiente)
        const mensagemErro = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : "Falha interna ao tentar processar o envio do Pix.";

        return res.status(500).json({ 
            success: false, 
            error: mensagemErro 
        });
    }
});

// Inicialização do Servidor na porta padrão do Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`[SERVER OK] Motor Pix de Payout rodando perfeitamente na porta ${PORT}`);
});
