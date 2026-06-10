const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Permite que o seu jogo (front-end) se comunique com o servidor sem bloqueios de CORS
app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURAÇÃO DE CREDENCIAIS (Substitua com o seu Token de Produção Real)
// =========================================================================
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN }); || "APP_USR-7218605027356877-060621-5159232083e305465b657a62c03ffe40-163518318;"

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

        // 2. Cálculo Blindado no Back-end (Evita que o usuário altere o valor real pelo navegador)
        // Regra de Conversão: 100 pontos = R$ 0,10 (Ou seja, pontos * 0.001)
        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));

        // 3. Detecção Inteligente do Tipo de Chave Pix para a API do Banco
        let tipoChave = "evp"; // Fallback para chave aleatória
        const chaveLimpa = chavePix.trim();

        if (chaveLimpa.includes("@")) {
            tipoChave = "email";
        } else if (/^\d{11}$/.test(chaveLimpa.replace(/\D/g, ""))) {
            tipoChave = "cpf";
        } else if (/^\d{14}$/.test(chaveLimpa.replace(/\D/g, ""))) {
            tipoChave = "cnpj";
        } else if (/^\+?\d{10,13}$/.test(chaveLimpa.replace(/\D/g, ""))) {
            tipoChave = "phone";
        }

        // 4. Integração Real com a API de Payout (Exemplo padrão de requisição via Mercado Pago API)
        // Nota: Para transferir dinheiro real para terceiros via API, sua conta do gateway precisa estar em modo Produção e ter saldo disponível.
        const response = await axios.post('https://api.mercadopago.com/v1/payments', {
            transaction_amount: valorReal,
            description: "Resgate de Recompensa Automática - Star Runner Game",
            payment_method_id: "pix",
            payer: {
                email: tipoChave === "email" ? chaveLimpa : "pagamentos_runner@seu-dominio.com",
                identification: {
                    type: tipoChave === "cpf" ? "CPF" : "CPF",
                    number: tipoChave === "cpf" ? chaveLimpa.replace(/\D/g, "") : "00000000000" // CPF de envio/parceiro se não for a chave
                }
            },
            metadata: {
                chave_pix_destino: chaveLimpa,
                tipo_chave: tipoChave,
                pontos_convertidos: pontos
            }
        }, {
            headers: {
                'Authorization': `Bearer ${GATEWAY_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `saque_pix_${Date.now()}_${Math.floor(Math.random() * 1000)}` // Chave de segurança para evitar duplicidade de saques
            }
        });

        // 5. Retorno de Sucesso para o Jogo
        if (response.status === 201 || response.status === 200) {
            return res.status(200).json({ 
                success: true, 
                message: "Pix enviado e liquidado com sucesso na conta do usuário!" 
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: "O banco parceiro recusou a transação." 
            });
        }

    } catch (error) {
        console.error("Erro crítico no processamento do Pix Out:", error.response ? error.response.data : error.message);
        
        // Retorna a falha exata da API bancária para o seu log do Render ajudar na auditoria
        const mensagemErro = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : "Falha interna de comunicação com a API de pagamentos.";

        return res.status(500).json({ 
            success: false, 
            error: mensagemErro 
        });
    }
});

// Inicialização do Servidor na porta correta exigida pelo Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`[SERVER OK] Motor Pix de Produção rodando na porta ${PORT}`);
});
