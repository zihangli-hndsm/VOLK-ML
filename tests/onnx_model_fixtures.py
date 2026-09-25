"""Real ONNX ModelProto fixtures shared by the configured extractor regression."""

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def _tensor(name, value):
    return numpy_helper.from_array(np.asarray(value, dtype=np.float32), name)


def _model(graph, opset=13):
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", opset)])
    onnx.checker.check_model(model)
    return model


def make_model(kind="gemm-mlp", opset=13):
    if kind in ("gemm-mlp", "sigmoid-mlp"):
        inputs = [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 4])]
        outputs = [helper.make_tensor_value_info("y", TensorProto.FLOAT, ["batch", 2])]
        initializers = [
            _tensor("w0", [[123456.75] * 4] * 3),
            _tensor("b0", [0.1, 0.2, 0.3]),
            _tensor("w1", [[-0.4] * 3] * 2),
            _tensor("b1", [0.4, 0.5]),
        ]
        nodes = [
            helper.make_node("Gemm", ["x", "w0", "b0"], ["h"], transB=1),
            helper.make_node("Sigmoid" if kind == "sigmoid-mlp" else "Relu", ["h"], ["r"]),
            helper.make_node("Gemm", ["r", "w1", "b1"], ["z"], transB=1),
            helper.make_node("Softmax", ["z"], ["y"]),
        ]
        graph = helper.make_graph(nodes, "gemm_mlp", inputs, outputs, initializers)
        return _model(graph, opset)

    if kind == "gemm-transb0":
        inputs = [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 4])]
        outputs = [helper.make_tensor_value_info("y", TensorProto.FLOAT, ["batch", 2])]
        weight = _tensor("w", [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6], [0.7, 0.8]])
        node = helper.make_node("Gemm", ["x", "w"], ["y"], transB=0)
        return _model(helper.make_graph([node], "gemm_transb0", inputs, outputs, [weight]), opset)

    if kind == "matmul-add-mlp":
        inputs = [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 4])]
        outputs = [helper.make_tensor_value_info("y", TensorProto.FLOAT, ["batch", 2])]
        initializers = [
            _tensor("w0", [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9], [1.0, 1.1, 1.2]]),
            _tensor("b0", [0.1, 0.2, 0.3]),
            _tensor("w1", [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]),
        ]
        nodes = [
            helper.make_node("MatMul", ["x", "w0"], ["mm"]),
            helper.make_node("Add", ["b0", "mm"], ["biased"]),
            helper.make_node("Tanh", ["biased"], ["act"]),
            helper.make_node("MatMul", ["act", "w1"], ["y"]),
        ]
        graph = helper.make_graph(nodes, "matmul_add_mlp", inputs, outputs, initializers)
        return _model(graph, opset)

    if kind in ("flatten", "reshape"):
        inputs = [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 2, 2])]
        outputs = [helper.make_tensor_value_info("y", TensorProto.FLOAT, ["batch", 2])]
        initializers = [_tensor("w", [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]])]
        if kind == "flatten":
            nodes = [helper.make_node("Flatten", ["x"], ["flat"], axis=1)]
        else:
            shape = numpy_helper.from_array(np.asarray([0, 4], dtype=np.int64), "target_shape")
            initializers.append(shape)
            nodes = [helper.make_node("Reshape", ["x", "target_shape"], ["flat"])]
        nodes.append(helper.make_node("Gemm", ["flat", "w"], ["y"], transB=1))
        graph = helper.make_graph(nodes, kind, inputs, outputs, initializers)
        return _model(graph, opset)

    if kind == "unsupported-op":
        inputs = [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", 4])]
        outputs = [helper.make_tensor_value_info("y", TensorProto.FLOAT, ["batch", 4])]
        graph = helper.make_graph([helper.make_node("Dropout", ["x"], ["y"])], "unsupported", inputs, outputs)
        return _model(graph, opset)

    raise ValueError(kind)
