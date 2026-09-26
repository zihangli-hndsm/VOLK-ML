from torch import nn


class ReferenceMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.hidden = nn.Linear(4, 32)
        self.output = nn.Linear(32, 2)

    def forward(self, inputs):
        return self.output(nn.functional.relu(self.hidden(inputs)))
