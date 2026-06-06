const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(express.json());
app.use(cors()); // Permite que o seu jogo no Render acesse este backend

// Configuração da credencial secreta do Mercado Pago
// Substitua pelo seu Access Token de Produção ou Teste obtido no painel de desenvolvedor do Mercado Pago
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-SEU-TOKEN-PRODUCAO-AQUI' 
});

const payment = new Payment(client);

app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        // 1. Validações de segurança no servidor
        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Dados incompletos." });
        }
        if (pontos < 1000) {
            return res.status(400).json({ success: false, error: "Pontuação mínima não atingida." });
        }

        // 2. Define a taxa de conversão (Exemplo: 1000 pontos = R$ 1.00)
        const valorDoSaque = (pontos / 1000).toFixed(2);

        // 3. Monta a requisição estruturada da API do Mercado Pago
        const paymentData = {
            body: {
                transaction_amount: parseFloat(valorDoSaque),
                description: 'Resgate de Pontos - Star Runner Game',
                payment_method_id: 'pix',
                payer: {
                    email: 'jogador_star_runner@email.com', // Pode ser dinâmico caso use login
                    first_name: 'Jogador',
                    last_name: 'StarRunner',
                    identification: {
                        type: 'CPF',
                        number: '00000000000' // CPF do pagador/recebedor se necessário em produção
                    }
                }
            }
        };

        // 4. Executa a chamada na API oficial do Mercado Pago
        const response = await payment.create(paymentData);

        // Se o Mercado Pago processar corretamente a transação
        if (response.id) {
            return res.status(200).json({
                success: true,
                message: `R$ ${valorDoSaque} enviados com sucesso para a chave ${chavePix}.`
            });
        } else {
            return res.status(400).json({ success: false, error: "A API do Mercado Pago recusou a transação." });
        }

    } catch (error) {
        console.error("Erro na API Mercado Pago:", error);
        return res.status(500).json({ success: false, error: "Erro interno no servidor de pagamento." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de saques ativo na porta ${PORT}`);
});
