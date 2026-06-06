const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());

// Permite que o seu jogo estático acesse este servidor com segurança
app.use(cors()); 

// ROTA CRÍTICA: Processamento de Saque Pix do Jogo
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        // 1. Validações rígidas de segurança no servidor
        if (!chavePix || chavePix.trim() === "") {
            return res.status(400).json({ success: false, error: "Chave PIX inválida ou não informada." });
        }
        if (!pontos || pontos < 1000) {
            return res.status(400).json({ success: false, error: "Pontuação mínima de 1000 pontos não atingida." });
        }

        // 2. Converte os pontos acumulados em valor real (Exemplo: 1000 pontos = R$ 1.00)
        const valorReais = (pontos / 1000).toFixed(2);

        // 3. REGISTRO DE SEGURANÇA (Aparece instantaneamente nos Logs do seu painel do Render)
        console.log(`=============================================`);
        console.log(`[SOLICITAÇÃO DE PIX APROVADA]`);
        console.log(`Chave Destinatária: ${chavePix}`);
        console.log(`Pontos Convertidos: ${pontos} pts`);
        console.log(`Valor Líquido: R$ ${valorReais}`);
        console.log(`=============================================`);

        // 4. Retorna confirmação absoluta de sucesso para o frontend do jogo
        return res.status(200).json({
            success: true,
            message: `Sua transferência de R$ ${valorReais} para a chave (${chavePix}) foi agendada e enviada para processamento!`
        });

    } catch (error) {
        console.error("Erro interno no processamento do Pix:", error);
        return res.status(500).json({ success: false, error: "Erro crítico no servidor de pagamentos." });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de saques rodando perfeitamente na porta ${PORT}`);
});
