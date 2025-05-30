// controllers/taskController.js
const Performance = require('../../models/Performance');
const Task = require('../../models/Task');
const moment = require('moment');
const Project = require('../../models/Project');
const User = require('../../models/User');
const { createNotification } = require('../../utils/notification');

const taskController = {
  // Get all tasks
  getTaskAll: async (req, res) => {
    try {
      const tasks = await Task.find()
        .sort({ priority: 1, createdAt: -1 }) // High priority first, then newest
        .populate('createdBy', 'name')
        .populate('assignedTo', 'name')
        .populate('project', 'name');
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
  getTaskAllByUserId: async (req, res) => {
    try {
      console.log("finding the tasks of user", req.params.id)
      const user = req.params.id
      const tasks = await Task.find({
        assignedTo: user
      }).sort({ priority: 1, createdAt: -1 })
        .populate('createdBy', 'name')
        .populate('assignedTo', 'name')
        .populate('project', 'name');
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get task by ID
  getTaskById: async (req, res) => {
    try {
      const task = await Task.findById(req.params.id)
        .populate('createdBy', 'name')
        .populate('assignedTo', 'name')
        .populate('project', 'name');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get tasks by deadline
  getTaskByDeadline: async (req, res) => {
    try {
      const date = moment(req.params.date).startOf('day');
      const tasks = await Task.find({
        deadline: {
          $gte: date.toDate(),
          $lt: moment(date).endOf('day').toDate()
        }
      }).populate('assignedTo', 'name');
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Add new task
  addTask: async (req, res) => {
    try {
      const taskData = {
        ...req.body,
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
        assignedTo: req.body.assignedTo || req.user.userId,
        files: req.files?.map(file => ({
          filename: file.originalname,
          path: file.path
        }))
      };

      const task = new Task(taskData);
      await task.save();
      res.status(201).json(task);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  },

  // Update task
  updateTask: async (req, res) => {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Add new files if any
      if (req.files && req.files.length > 0) {
        const newFiles = req.files.map(file => ({
          filename: file.originalname,
          path: file.path
        }));
        req.body.files = [...(task.files || []), ...newFiles];
      }

      req.body.updatedBy = req.user.userId;
      const updatedTask = await Task.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );
      res.json(updatedTask);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  },

  // Delete task
  deleteTask: async (req, res) => {
    try {
      const task = await Task.findByIdAndDelete(req.params.id);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      res.json({ message: 'Task deleted' });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  updateTaskStatus: async (req, res) => {
    try {
      const { taskId } = req.params;
      const { status, comment } = req.body;
      const userId = req.user._id;

      // Find the project containing the task
      const project = await Project.findOne({
        'tasks._id': taskId
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      // Find the specific task
      const task = project.tasks.id(taskId);

      // Check if user has access to update this task
      if (task.assignedTo.toString() !== userId.toString() &&
        project.projectHead.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this task'
        });
      }

      // Update task status
      task.status = status;
      if (comment) {
        task.comments.push({
          content: comment,
          createdBy: userId,
          createdAt: new Date()
        });
      }

      // Add status change to history
      task.history.push({
        status,
        updatedBy: userId,
        updatedAt: new Date(),
        comment
      });

      await project.save();

      // Send notification to project head if task status changes
      if (project.projectHead.toString() !== userId.toString()) {
        await createNotification({
          userId: project.projectHead,
          type: 'task_update',
          message: `Task "${task.title}" status updated to ${status}`,
          reference: {
            type: 'Task',
            id: task._id
          }
        });
      }

      res.json({
        success: true,
        data: task
      });
    } catch (error) {
      console.error('Error in updateTaskStatus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update task status',
        error: error.message
      });
    }
  },

  // Update task completion approval with performance tracking
  updateTaskisCompletedApprove: async (req, res) => {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      if (task.status !== 'Completed') {
        return res.status(400).json({
          message: 'Cannot approve task that is not completed'
        });
      }

      task.isCompletedApproved = req.body.isCompletedApproved;
      task.updatedBy = req.user.userId;
      await task.save();

      // Create performance record for successful completion
      if (req.body.isCompletedApproved) {
        await new Performance({
          category: 'task_completed',
          points: 1,
          remark: `Task "${task.description}" completed and approved`,
          user_id: task.assignedTo,
          createdBy: req.user.userId,
          taskId: task._id
        }).save();
      }

      res.json(task);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  },
  // Get analytics for self-assigned tasks
  getAnalyticsByUserIdSelf: async (req, res) => {
    try {
      let startDate = "";
      let endDate = ""
      if (req.query.startDate && req.query.endDate) {
        startDate = req.query.startDate;
        endDate = req.query.endDate;
      }
      else {
        startDate = moment().startOf('month');
        endDate = moment().endOf('month');
      }


      const tasks = await Task.find({
        createdBy: req.user.userId,
        assignedTo: req.user.userId,
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalTasks = tasks.length;
      const completedTasks = tasks?.filter(task =>
        task.status === 'Completed' && task.isCompletedApproved
      ).length;

      res.json({
        totalTasks,
        completedTasks,
        completionRate: totalTasks ? (completedTasks / totalTasks) * 100 : 0
      });
    } catch (error) {
      console.log("error analytics:", error)
      res.status(500).json({ message: error.message });
    }
  },

  // Get analytics for tasks assigned by others
  getAnalyticsByUserIdAssigned: async (req, res) => {
    try {
      let startDate = "";
      let endDate = ""
      if (req.query.startDate && req.query.endDate) {
        startDate = req.query.startDate;
        endDate = req.query.endDate;
      }
      else {
        startDate = moment().startOf('month');
        endDate = moment().endOf('month');
      }

      const tasks = await Task.find({
        assignedTo: req.user.userId,
        createdBy: { $ne: req.user.userId },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalTasks = tasks.length;
      const completedTasks = tasks?.filter(task =>
        task.status === 'Completed' && task.isCompletedApproved
      ).length;

      res.json({
        totalTasks,
        completedTasks,
        completionRate: totalTasks ? (completedTasks / totalTasks) * 100 : 0
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  async getMyTasks(req, res) {
    try {
      const userId = req.user._id;
      
      // Find all projects where user is a member or project head
      const projects = await Project.find({
        $or: [
          { projectHead: userId },
          { members: userId }
        ]
      }).populate('projectHead', 'name photo')
        .populate('members', 'name photo');

      // Extract and format tasks from all projects
      let allTasks = [];
      projects.forEach(project => {
        const projectTasks = project.tasks || [];
        projectTasks.forEach(task => {
          if (task.assignedTo.toString() === userId.toString()) {
            allTasks.push({
              ...task.toObject(),
              projectId: project._id,
              projectName: project.name,
              projectHead: project.projectHead
            });
          }
        });
      });

      // Sort tasks by priority and due date
      allTasks.sort((a, b) => {
        if (a.priority !== b.priority) {
          const priorityOrder = { high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return new Date(a.dueDate) - new Date(b.dueDate);
      });

      res.json({
        success: true,
        data: allTasks
      });
    } catch (error) {
      console.error('Error in getMyTasks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch tasks',
        error: error.message
      });
    }
  },

  async getTaskById(req, res) {
    try {
      const { taskId } = req.params;
      const userId = req.user._id;

      // Find the project containing the task
      const project = await Project.findOne({
        'tasks._id': taskId
      }).populate('projectHead', 'name photo')
        .populate('members', 'name photo');

      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      // Find the specific task
      const task = project.tasks.id(taskId);

      // Check if user has access to this task
      const hasAccess = task.assignedTo.toString() === userId.toString() ||
                      project.projectHead._id.toString() === userId.toString() ||
                      project.members.some(member => member._id.toString() === userId.toString());

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this task'
        });
      }

      res.json({
        success: true,
        data: {
          ...task.toObject(),
          projectId: project._id,
          projectName: project.name,
          projectHead: project.projectHead
        }
      });
    } catch (error) {
      console.error('Error in getTaskById:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch task',
        error: error.message
      });
    }
  },

};

module.exports = taskController;